package manga

import (
	"fmt"
	"seanime/internal/api/anilist"
	"seanime/internal/events"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// AutoDownloader automatically downloads new chapters for manga in the reading list
// that have 90%+ of their chapters already downloaded.
// It uses the same provider/source that each manga entry was originally downloaded from.
// It skips manga that are marked as FINISHED on AniList.
type AutoDownloader struct {
	logger         *zerolog.Logger
	downloader     *Downloader
	repository     *Repository
	wsEventManager events.WSEventManagerInterface

	// Function to get manga collection (injected to avoid circular dependency)
	getMangaCollection func() (*anilist.MangaCollection, error)

	mu              sync.Mutex
	running         bool
	stopCh          chan struct{}
	lastCheckTime   time.Time
	checkInterval   time.Duration
	rateLimitDelay  time.Duration // Delay between checking each manga
	minDownloadPct  float64       // Minimum percentage of chapters downloaded to trigger auto-download
}

type NewAutoDownloaderOptions struct {
	Logger             *zerolog.Logger
	Downloader         *Downloader
	Repository         *Repository
	WSEventManager     events.WSEventManagerInterface
	GetMangaCollection func() (*anilist.MangaCollection, error)
}

func NewAutoDownloader(opts *NewAutoDownloaderOptions) *AutoDownloader {
	return &AutoDownloader{
		logger:             opts.Logger,
		downloader:         opts.Downloader,
		repository:         opts.Repository,
		wsEventManager:     opts.WSEventManager,
		getMangaCollection: opts.GetMangaCollection,
		checkInterval:      3 * time.Hour,    // Check every 3 hours
		rateLimitDelay:     10 * time.Second, // 10 second delay between each manga check to avoid rate limiting
		minDownloadPct:     0.95,             // 90% of chapters must be downloaded
	}
}

// Start begins the auto-download background job
func (ad *AutoDownloader) Start() {
	ad.mu.Lock()
	if ad.running {
		ad.mu.Unlock()
		return
	}
	ad.running = true
	ad.stopCh = make(chan struct{})
	ad.mu.Unlock()

	ad.logger.Info().Msg("manga auto-downloader: Starting background job (checks every 3 hours)")

	go ad.run()
}

// Stop stops the auto-download background job
func (ad *AutoDownloader) Stop() {
	ad.mu.Lock()
	defer ad.mu.Unlock()

	if !ad.running {
		return
	}

	ad.running = false
	close(ad.stopCh)
	ad.logger.Info().Msg("manga auto-downloader: Stopped background job")
}

func (ad *AutoDownloader) run() {
	// Wait a bit before first check to let the app initialize
	select {
	case <-ad.stopCh:
		return
	case <-time.After(1 * time.Minute):
	}

	// Run first check
	ad.checkAndDownloadNewChapters()

	ticker := time.NewTicker(ad.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ad.stopCh:
			return
		case <-ticker.C:
			ad.checkAndDownloadNewChapters()
		}
	}
}

// checkAndDownloadNewChapters checks all manga in the reading list and downloads new chapters
// for those with 90%+ chapters already downloaded, using the same provider they were downloaded from.
// It skips manga that are marked as FINISHED on AniList.
func (ad *AutoDownloader) checkAndDownloadNewChapters() {
	ad.mu.Lock()
	ad.lastCheckTime = time.Now()
	ad.mu.Unlock()

	ad.logger.Info().Msg("manga auto-downloader: Starting check for new chapters")

	// Get the reading list from database
	toReadIds, err := ad.downloader.database.GetMangaToReadMediaIds()
	if err != nil {
		ad.logger.Error().Err(err).Msg("manga auto-downloader: Failed to get reading list")
		return
	}

	if len(toReadIds) == 0 {
		ad.logger.Debug().Msg("manga auto-downloader: No manga in reading list")
		return
	}

	// Get manga collection to check status
	var mangaCollection *anilist.MangaCollection
	if ad.getMangaCollection != nil {
		mangaCollection, _ = ad.getMangaCollection()
	}

	// Build a map of mediaId -> status for quick lookup
	mediaStatusMap := make(map[int]anilist.MediaStatus)
	mediaTitleMap := make(map[int]string)
	if mangaCollection != nil {
		for _, list := range mangaCollection.MediaListCollection.GetLists() {
			for _, entry := range list.GetEntries() {
				media := entry.GetMedia()
				if media != nil && media.Status != nil {
					mediaStatusMap[media.ID] = *media.Status
					// Get title for notifications
					if media.Title != nil && media.Title.UserPreferred != nil {
						mediaTitleMap[media.ID] = *media.Title.UserPreferred
					}
				}
			}
		}
	}

	// Get the current media map (downloaded chapters)
	ad.downloader.mediaMapMu.RLock()
	mediaMap := *ad.downloader.mediaMap
	ad.downloader.mediaMapMu.RUnlock()

	checkedCount := 0
	downloadedCount := 0
	notifiedManga := make([]string, 0) // Track manga with new chapters for notification

	for _, mediaId := range toReadIds {
		// Check if we should stop
		select {
		case <-ad.stopCh:
			ad.logger.Info().Msg("manga auto-downloader: Stopped during check")
			return
		default:
		}

		// Check manga status - skip if FINISHED
		if status, ok := mediaStatusMap[mediaId]; ok {
			if status == anilist.MediaStatusFinished {
				ad.logger.Debug().Int("mediaId", mediaId).Msg("manga auto-downloader: Skipping finished manga")
				continue
			}
		}

		// Check if this manga has any downloaded chapters
		providerMap, hasDownloads := mediaMap[mediaId]
		if !hasDownloads {
			continue
		}

		// Find the provider with the most downloaded chapters (the one the user is using)
		var primaryProvider string
		var maxChapters int
		for provider, chapters := range providerMap {
			if len(chapters) > maxChapters {
				maxChapters = len(chapters)
				primaryProvider = provider
			}
		}

		if primaryProvider == "" || maxChapters == 0 {
			continue
		}

		// Rate limit: wait between each manga check
		if checkedCount > 0 {
			select {
			case <-ad.stopCh:
				return
			case <-time.After(ad.rateLimitDelay):
			}
		}

		checkedCount++

		// Get the chapter container from the source (this will fetch fresh data)
		container, err := ad.repository.GetMangaChapterContainer(&GetMangaChapterContainerOptions{
			Provider: primaryProvider,
			MediaId:  mediaId,
			Titles:   nil, // Will use cached manga info
			Year:     0,
		})
		if err != nil {
			ad.logger.Warn().Err(err).Int("mediaId", mediaId).Str("provider", primaryProvider).
				Msg("manga auto-downloader: Failed to get chapter container")
			continue
		}

		if container == nil || len(container.Chapters) == 0 {
			continue
		}

		totalChapters := len(container.Chapters)
		downloadedChapters := len(providerMap[primaryProvider])

		// Calculate download percentage
		downloadPct := float64(downloadedChapters) / float64(totalChapters)

		ad.logger.Debug().
			Int("mediaId", mediaId).
			Str("provider", primaryProvider).
			Int("downloaded", downloadedChapters).
			Int("total", totalChapters).
			Float64("percentage", downloadPct*100).
			Msg("manga auto-downloader: Checking manga")

		// Skip if less than 90% downloaded
		if downloadPct < ad.minDownloadPct {
			continue
		}

		// Find chapters that are not downloaded
		downloadedChapterIds := make(map[string]bool)
		for _, ch := range providerMap[primaryProvider] {
			downloadedChapterIds[ch.ChapterID] = true
		}

		newChaptersToDownload := make([]string, 0)
		for _, chapter := range container.Chapters {
			if !downloadedChapterIds[chapter.ID] {
				newChaptersToDownload = append(newChaptersToDownload, chapter.ID)
			}
		}

		if len(newChaptersToDownload) == 0 {
			ad.logger.Debug().Int("mediaId", mediaId).Msg("manga auto-downloader: No new chapters to download")
			continue
		}

		// Get manga title for notification
		mangaTitle := mediaTitleMap[mediaId]
		if mangaTitle == "" {
			mangaTitle = fmt.Sprintf("Manga #%d", mediaId)
		}

		ad.logger.Info().
			Int("mediaId", mediaId).
			Str("title", mangaTitle).
			Str("provider", primaryProvider).
			Int("newChapters", len(newChaptersToDownload)).
			Msg("manga auto-downloader: Found new chapters to download")

		// Track for notification
		notifiedManga = append(notifiedManga, fmt.Sprintf("%s (%d new)", mangaTitle, len(newChaptersToDownload)))

		// Download new chapters (with rate limiting between each)
		for i, chapterId := range newChaptersToDownload {
			// Rate limit between chapter downloads
			if i > 0 {
				select {
				case <-ad.stopCh:
					return
				case <-time.After(2 * time.Second):
				}
			}

			err := ad.downloader.DownloadChapter(DownloadChapterOptions{
				Provider:  primaryProvider,
				MediaId:   mediaId,
				ChapterId: chapterId,
				StartNow:  false, // Queue it, don't start immediately
			})
			if err != nil {
				ad.logger.Warn().Err(err).
					Int("mediaId", mediaId).
					Str("chapterId", chapterId).
					Msg("manga auto-downloader: Failed to queue chapter download")
				continue
			}

			downloadedCount++
			ad.logger.Debug().
				Int("mediaId", mediaId).
				Str("chapterId", chapterId).
				Msg("manga auto-downloader: Queued chapter for download")
		}
	}

	// Send notification if new chapters were found
	if len(notifiedManga) > 0 && ad.wsEventManager != nil {
		ad.wsEventManager.SendEvent(events.MangaNewChaptersFound, map[string]interface{}{
			"manga":       notifiedManga,
			"totalQueued": downloadedCount,
		})
	}

	ad.logger.Info().
		Int("checkedManga", checkedCount).
		Int("queuedChapters", downloadedCount).
		Msg("manga auto-downloader: Finished check for new chapters")
}

// GetStatus returns the current status of the auto-downloader
func (ad *AutoDownloader) GetStatus() map[string]interface{} {
	ad.mu.Lock()
	defer ad.mu.Unlock()

	return map[string]interface{}{
		"running":       ad.running,
		"lastCheckTime": ad.lastCheckTime,
		"checkInterval": ad.checkInterval.String(),
		"nextCheckIn":   time.Until(ad.lastCheckTime.Add(ad.checkInterval)).String(),
	}
}

// RunNow triggers an immediate check for new chapters
func (ad *AutoDownloader) RunNow() error {
	ad.mu.Lock()
	if !ad.running {
		ad.mu.Unlock()
		return fmt.Errorf("auto-downloader is not running")
	}
	ad.mu.Unlock()

	go ad.checkAndDownloadNewChapters()
	return nil
}
