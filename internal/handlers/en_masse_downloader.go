package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"seanime/internal/api/anilist"
	"seanime/internal/database/models"
	"seanime/internal/events"
	"seanime/internal/manga"
	"seanime/internal/platforms/shared_platform"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	// MaxMangaInQueue is the maximum number of distinct manga that can be in the download queue at once
	MaxMangaInQueue = 50

	offlineErrorThreshold = 3
)

// HakunekoMangaEntry represents a manga entry from the HakuneKo export file
type HakunekoMangaEntry struct {
	Title string `json:"title"`
}

// EnMasseDownloaderStatus represents the current status of the en masse downloader
type EnMasseDownloaderStatus struct {
	IsRunning          bool                 `json:"isRunning"`
	CurrentMangaIndex  int                  `json:"currentMangaIndex"`
	TotalMangaCount    int                  `json:"totalMangaCount"`
	CurrentMangaTitle  string               `json:"currentMangaTitle"`
	CurrentPhase       string               `json:"currentPhase"` // "searching", "fetching_chapters", "queueing", "waiting", "waiting_queue", "idle"
	ProcessedManga     []ProcessedMangaInfo `json:"processedManga"`
	FailedManga        []FailedMangaInfo    `json:"failedManga"`
	QueuedChapterCount int                  `json:"queuedChapterCount"`
	FilePath           string               `json:"filePath"`
	Provider           string               `json:"provider"`
	CanResume          bool                 `json:"canResume"` // Whether there's a saved state to resume from
}

type ProcessedMangaInfo struct {
	Title        string `json:"title"`
	MediaId      int    `json:"mediaId"`
	ChapterCount int    `json:"chapterCount"`
}

type FailedMangaInfo struct {
	Title  string `json:"title"`
	Reason string `json:"reason"`
}

var (
	enMasseDownloaderMu     sync.Mutex
	enMasseDownloaderStatus = &EnMasseDownloaderStatus{
		IsRunning:      false,
		ProcessedManga: []ProcessedMangaInfo{},
		FailedManga:    []FailedMangaInfo{},
	}
	enMasseDownloaderCancelCh chan struct{}
)

// HandleGetEnMasseDownloaderStatus
//
//	@summary returns the current status of the en masse downloader.
//	@route /api/v1/manga/en-masse/status [GET]
//	@returns EnMasseDownloaderStatus
func (h *Handler) HandleGetEnMasseDownloaderStatus(c echo.Context) error {
	enMasseDownloaderMu.Lock()
	defer enMasseDownloaderMu.Unlock()

	// Check if there's a saved state to resume from
	savedState, err := h.App.Database.GetEnMasseDownloaderState()
	if err == nil && savedState != nil && savedState.IsActive && !enMasseDownloaderStatus.IsRunning {
		enMasseDownloaderStatus.CanResume = true
		enMasseDownloaderStatus.FilePath = savedState.FilePath
		enMasseDownloaderStatus.Provider = savedState.Provider
		enMasseDownloaderStatus.CurrentMangaIndex = savedState.CurrentIndex
		enMasseDownloaderStatus.TotalMangaCount = savedState.TotalCount
		enMasseDownloaderStatus.QueuedChapterCount = savedState.QueuedChapterCount

		// Restore processed and failed manga from JSON
		if len(savedState.ProcessedMangaJSON) > 0 {
			_ = json.Unmarshal(savedState.ProcessedMangaJSON, &enMasseDownloaderStatus.ProcessedManga)
		}
		if len(savedState.FailedMangaJSON) > 0 {
			_ = json.Unmarshal(savedState.FailedMangaJSON, &enMasseDownloaderStatus.FailedManga)
		}
	} else {
		enMasseDownloaderStatus.CanResume = false
	}

	return h.RespondWithData(c, enMasseDownloaderStatus)
}

// HandleLoadHakunekoFile
//
//	@summary loads and parses a HakuneKo manga export file.
//	@route /api/v1/manga/en-masse/load-file [POST]
//	@returns []HakunekoMangaEntry
func (h *Handler) HandleLoadHakunekoFile(c echo.Context) error {
	type body struct {
		FilePath string `json:"filePath"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	if b.FilePath == "" {
		return h.RespondWithError(c, errors.New("file path is required"))
	}

	// Read the file
	data, err := os.ReadFile(b.FilePath)
	if err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to read file: %w", err))
	}

	// Parse the JSON
	var entries []HakunekoMangaEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to parse file: %w", err))
	}

	return h.RespondWithData(c, entries)
}

// HandleStartEnMasseDownloader
//
//	@summary starts the en masse downloader process.
//	@desc This will search for each manga on AniList, fetch chapters from the provider, and queue all chapters for download.
//	@desc If resume is true and there's a saved state, it will resume from where it left off.
//	@route /api/v1/manga/en-masse/start [POST]
//	@returns bool
func (h *Handler) HandleStartEnMasseDownloader(c echo.Context) error {
	type body struct {
		FilePath string `json:"filePath"`
		Provider string `json:"provider"`
		Resume   bool   `json:"resume"` // If true, resume from saved state
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	enMasseDownloaderMu.Lock()
	if enMasseDownloaderStatus.IsRunning {
		enMasseDownloaderMu.Unlock()
		return h.RespondWithError(c, errors.New("en masse downloader is already running"))
	}
	enMasseDownloaderMu.Unlock()

	var entries []HakunekoMangaEntry
	var startIndex int
	var processedManga []ProcessedMangaInfo
	var failedManga []FailedMangaInfo
	var queuedChapterCount int

	// Check if we should resume from saved state
	if b.Resume {
		savedState, err := h.App.Database.GetEnMasseDownloaderState()
		if err != nil || savedState == nil || !savedState.IsActive {
			return h.RespondWithError(c, errors.New("no saved state to resume from"))
		}

		b.FilePath = savedState.FilePath
		b.Provider = savedState.Provider
		startIndex = savedState.CurrentIndex
		queuedChapterCount = savedState.QueuedChapterCount

		// Restore processed and failed manga
		if len(savedState.ProcessedMangaJSON) > 0 {
			_ = json.Unmarshal(savedState.ProcessedMangaJSON, &processedManga)
		}
		if len(savedState.FailedMangaJSON) > 0 {
			_ = json.Unmarshal(savedState.FailedMangaJSON, &failedManga)
		}
	}

	if b.FilePath == "" {
		return h.RespondWithError(c, errors.New("file path is required"))
	}

	if b.Provider == "" {
		return h.RespondWithError(c, errors.New("provider is required"))
	}

	// Read the file
	data, err := os.ReadFile(b.FilePath)
	if err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to read file: %w", err))
	}

	// Parse the JSON
	if err := json.Unmarshal(data, &entries); err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to parse file: %w", err))
	}

	// Start the downloader in a goroutine
	go h.runEnMasseDownloader(entries, b.Provider, b.FilePath, startIndex, processedManga, failedManga, queuedChapterCount)

	return h.RespondWithData(c, true)
}

// HandleStopEnMasseDownloader
//
//	@summary stops the en masse downloader process.
//	@route /api/v1/manga/en-masse/stop [POST]
//	@returns bool
func (h *Handler) HandleStopEnMasseDownloader(c echo.Context) error {
	enMasseDownloaderMu.Lock()
	defer enMasseDownloaderMu.Unlock()

	if !enMasseDownloaderStatus.IsRunning {
		return h.RespondWithError(c, errors.New("en masse downloader is not running"))
	}

	// Signal cancellation
	if enMasseDownloaderCancelCh != nil {
		select {
		case <-enMasseDownloaderCancelCh:
			// already closed
		default:
			close(enMasseDownloaderCancelCh)
		}
		enMasseDownloaderCancelCh = nil
		enMasseDownloaderStatus.CurrentPhase = "stopping"
	}

	return h.RespondWithData(c, true)
}

// HandleResetEnMasseDownloader
//
//	@summary resets the en masse downloader status.
//	@route /api/v1/manga/en-masse/reset [POST]
//	@returns bool
func (h *Handler) HandleResetEnMasseDownloader(c echo.Context) error {
	enMasseDownloaderMu.Lock()
	defer enMasseDownloaderMu.Unlock()

	if enMasseDownloaderStatus.IsRunning {
		return h.RespondWithError(c, errors.New("cannot reset while downloader is running"))
	}

	// Clear the saved state from database
	_ = h.App.Database.DeleteEnMasseDownloaderState()

	enMasseDownloaderStatus = &EnMasseDownloaderStatus{
		IsRunning:      false,
		ProcessedManga: []ProcessedMangaInfo{},
		FailedManga:    []FailedMangaInfo{},
	}

	return h.RespondWithData(c, true)
}

func (h *Handler) runEnMasseDownloader(
	entries []HakunekoMangaEntry,
	provider string,
	filePath string,
	startIndex int,
	processedManga []ProcessedMangaInfo,
	failedManga []FailedMangaInfo,
	queuedChapterCount int,
) {
	if processedManga == nil {
		processedManga = []ProcessedMangaInfo{}
	}
	if failedManga == nil {
		failedManga = []FailedMangaInfo{}
	}

	enMasseDownloaderMu.Lock()
	enMasseDownloaderStatus = &EnMasseDownloaderStatus{
		IsRunning:          true,
		CurrentMangaIndex:  startIndex,
		TotalMangaCount:    len(entries),
		CurrentPhase:       "idle",
		ProcessedManga:     processedManga,
		FailedManga:        failedManga,
		QueuedChapterCount: queuedChapterCount,
		FilePath:           filePath,
		Provider:           provider,
	}
	enMasseDownloaderCancelCh = make(chan struct{})
	enMasseDownloaderMu.Unlock()

	cancelCh := enMasseDownloaderCancelCh

	// Helper function to save state to database
	saveState := func(currentIndex int, isActive bool) {
		enMasseDownloaderMu.Lock()
		processedJSON, _ := json.Marshal(enMasseDownloaderStatus.ProcessedManga)
		failedJSON, _ := json.Marshal(enMasseDownloaderStatus.FailedManga)
		state := &models.EnMasseDownloaderState{
			FilePath:           filePath,
			Provider:           provider,
			CurrentIndex:       currentIndex,
			TotalCount:         len(entries),
			ProcessedMangaJSON: processedJSON,
			FailedMangaJSON:    failedJSON,
			QueuedChapterCount: enMasseDownloaderStatus.QueuedChapterCount,
			IsActive:           isActive,
		}
		enMasseDownloaderMu.Unlock()
		_ = h.App.Database.SaveEnMasseDownloaderState(state)
	}

	defer func() {
		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.IsRunning = false
		enMasseDownloaderStatus.CurrentPhase = "idle"
		enMasseDownloaderMu.Unlock()
		h.App.WSEventManager.SendEvent(events.SuccessToast, "En Masse Downloader finished")
	}()

	if startIndex > 0 {
		h.App.WSEventManager.SendEvent(events.InfoToast, fmt.Sprintf("Resuming En Masse Downloader from manga %d/%d", startIndex+1, len(entries)))
	} else {
		h.App.WSEventManager.SendEvent(events.InfoToast, fmt.Sprintf("Starting En Masse Downloader for %d manga", len(entries)))
	}

	ctx := context.Background()

	updateStatus := func(mutator func(*EnMasseDownloaderStatus)) {
		enMasseDownloaderMu.Lock()
		defer enMasseDownloaderMu.Unlock()
		mutator(enMasseDownloaderStatus)
	}

	isPlaybackActive := func() bool {
		return h.App.PlaybackManager != nil && h.App.PlaybackManager.IsPlaybackActive()
	}

	waitForOfflineMode := func(currentIndex int, resumePhase string) bool {
		if !h.App.IsOffline() {
			return false
		}

		h.App.Logger.Warn().Msg("en-masse: App offline, pausing downloader")
		for h.App.IsOffline() {
			updateStatus(func(status *EnMasseDownloaderStatus) {
				status.CurrentPhase = "waiting_offline"
			})

			select {
			case <-cancelCh:
				saveState(currentIndex, true)
				h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
				return true
			case <-time.After(5 * time.Second):
			}
		}

		updateStatus(func(status *EnMasseDownloaderStatus) {
			if resumePhase != "" {
				status.CurrentPhase = resumePhase
			} else if status.CurrentPhase == "waiting_offline" {
				status.CurrentPhase = "idle"
			}
		})

		h.App.Logger.Info().Msg("en-masse: Offline mode cleared, resuming downloader")
		return false
	}

	throttleForPlayback := func(currentIndex int, resumePhase string, throttle time.Duration) bool {
		if !isPlaybackActive() {
			return false
		}

		updateStatus(func(status *EnMasseDownloaderStatus) {
			status.CurrentPhase = "waiting_playback"
		})

		h.App.Logger.Info().Dur("delay", throttle).Msg("en-masse: Playback active, throttling queueing")

		select {
		case <-cancelCh:
			saveState(currentIndex, true)
			h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
			return true
		case <-time.After(throttle):
		}

		updateStatus(func(status *EnMasseDownloaderStatus) {
			if resumePhase != "" {
				status.CurrentPhase = resumePhase
			} else if status.CurrentPhase == "waiting_playback" {
				status.CurrentPhase = "idle"
			}
		})
		return false
	}

	cooldownAfterOfflineError := func(reason string, currentIndex int, resumePhase string) bool {
		updateStatus(func(status *EnMasseDownloaderStatus) {
			status.CurrentPhase = "waiting_offline"
		})

		h.App.Logger.Warn().Str("reason", reason).Msg("en-masse: Connection issues detected, backing off")

		select {
		case <-cancelCh:
			saveState(currentIndex, true)
			h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
			return true
		case <-time.After(5 * time.Second):
		}

		updateStatus(func(status *EnMasseDownloaderStatus) {
			if resumePhase != "" {
				status.CurrentPhase = resumePhase
			} else if status.CurrentPhase == "waiting_offline" {
				status.CurrentPhase = "idle"
			}
		})
		return false
	}

	isOfflineLikeError := func(err error) bool {
		if err == nil {
			return false
		}

		msg := strings.ToLower(err.Error())
		offlineIndicators := []string{
			"offline",
			"connection",
			"timeout",
			"timed out",
			"no such host",
			"network is unreachable",
			"context deadline exceeded",
			"temporarily unavailable",
		}

		for _, indicator := range offlineIndicators {
			if strings.Contains(msg, indicator) {
				return true
			}
		}
		return false
	}

	var offlineErrorCount int
	handleOfflineError := func(err error, currentIndex int, resumePhase string) bool {
		if !isOfflineLikeError(err) {
			offlineErrorCount = 0
			return false
		}

		if h.App.IsOffline() {
			offlineErrorCount = 0
			return waitForOfflineMode(currentIndex, resumePhase)
		}

		offlineErrorCount++
		if offlineErrorCount < offlineErrorThreshold {
			return false
		}

		offlineErrorCount = 0
		return cooldownAfterOfflineError(err.Error(), currentIndex, resumePhase)
	}

	for i := startIndex; i < len(entries); i++ {
		entry := entries[i]

		if waitForOfflineMode(i, "searching") {
			return
		}
		if throttleForPlayback(i, "searching", 5*time.Second) {
			return
		}

		// Check for cancellation
		select {
		case <-cancelCh:
			// Save state before exiting so we can resume later
			saveState(i, true)
			h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
			return
		default:
		}

		// Check if we've reached the manga queue limit
		// Wait until a manga is fully downloaded before adding more
		for {
			distinctMangaCount, err := h.App.Database.GetDistinctMediaIdsInDownloadQueue()
			if err != nil {
				h.App.Logger.Warn().Err(err).Msg("en-masse: Failed to get distinct manga count in queue")
				break
			}

			if distinctMangaCount < MaxMangaInQueue {
				break
			}

			// Update status to show we're waiting for queue space
			enMasseDownloaderMu.Lock()
			enMasseDownloaderStatus.CurrentPhase = "waiting_queue"
			enMasseDownloaderStatus.CurrentMangaTitle = fmt.Sprintf("Waiting for queue space (%d/%d manga in queue)", distinctMangaCount, MaxMangaInQueue)
			enMasseDownloaderMu.Unlock()

			h.App.Logger.Info().Int64("queuedManga", distinctMangaCount).Msg("en-masse: Queue full, waiting for downloads to complete")

			// Check for cancellation while waiting
			select {
			case <-cancelCh:
				saveState(i, true)
				h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
				return
			case <-time.After(10 * time.Second):
				// Check again after 10 seconds
			}
		}

		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.CurrentMangaIndex = i + 1
		enMasseDownloaderStatus.CurrentMangaTitle = entry.Title
		enMasseDownloaderStatus.CurrentPhase = "searching"
		enMasseDownloaderMu.Unlock()

		// Save state periodically (every manga)
		saveState(i, true)

		h.App.Logger.Info().Str("title", entry.Title).Int("index", i+1).Int("total", len(entries)).Msg("en-masse: Processing manga")

		// Clean the title (remove newlines and extra info)
		cleanTitle := cleanMangaTitle(entry.Title)

		// Step 1: Search for the manga on AniList
	searchRetry:
		searchResult, err := h.searchMangaOnAnilist(ctx, cleanTitle)
		if err != nil {
			if handleOfflineError(err, i, "searching") {
				return
			}
			if isOfflineLikeError(err) {
				goto searchRetry
			}
			h.App.Logger.Warn().Err(err).Str("title", cleanTitle).Msg("en-masse: Failed to find manga on AniList")
			enMasseDownloaderMu.Lock()
			enMasseDownloaderStatus.FailedManga = append(enMasseDownloaderStatus.FailedManga, FailedMangaInfo{
				Title:  cleanTitle,
				Reason: fmt.Sprintf("AniList search failed: %v", err),
			})
			enMasseDownloaderMu.Unlock()
			// Rate limit between searches
			time.Sleep(2 * time.Second)
			continue
		}

		if searchResult == nil {
			h.App.Logger.Warn().Str("title", cleanTitle).Msg("en-masse: No AniList results found")
			enMasseDownloaderMu.Lock()
			enMasseDownloaderStatus.FailedManga = append(enMasseDownloaderStatus.FailedManga, FailedMangaInfo{
				Title:  cleanTitle,
				Reason: "No results found on AniList",
			})
			enMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		mediaId := searchResult.GetID()
		h.App.Logger.Info().Str("title", cleanTitle).Int("mediaId", mediaId).Msg("en-masse: Found manga on AniList")

		// Step 2: Fetch chapters from the provider
		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.CurrentPhase = "fetching_chapters"
		enMasseDownloaderMu.Unlock()

		// Rate limit before fetching chapters
		if throttleForPlayback(i, "fetching_chapters", 5*time.Second) {
			return
		}
		time.Sleep(1 * time.Second)

	fetchRetry:
		chapterContainer, err := h.App.MangaRepository.GetMangaChapterContainer(&manga.GetMangaChapterContainerOptions{
			Provider: provider,
			MediaId:  mediaId,
			Titles:   searchResult.GetAllTitles(),
			Year:     searchResult.GetStartYearSafe(),
		})
		if err != nil {
			if handleOfflineError(err, i, "fetching_chapters") {
				return
			}
			if isOfflineLikeError(err) {
				goto fetchRetry
			}
			h.App.Logger.Warn().Err(err).Str("title", cleanTitle).Msg("en-masse: Failed to fetch chapters")
			enMasseDownloaderMu.Lock()
			enMasseDownloaderStatus.FailedManga = append(enMasseDownloaderStatus.FailedManga, FailedMangaInfo{
				Title:  cleanTitle,
				Reason: fmt.Sprintf("Failed to fetch chapters: %v", err),
			})
			enMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		if chapterContainer == nil || len(chapterContainer.Chapters) == 0 {
			h.App.Logger.Warn().Str("title", cleanTitle).Msg("en-masse: No chapters found")
			enMasseDownloaderMu.Lock()
			enMasseDownloaderStatus.FailedManga = append(enMasseDownloaderStatus.FailedManga, FailedMangaInfo{
				Title:  cleanTitle,
				Reason: "No chapters found from provider",
			})
			enMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		// Step 3: Queue all chapters for download
		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.CurrentPhase = "queueing"
		enMasseDownloaderMu.Unlock()

		chapterCount := len(chapterContainer.Chapters)
		h.App.Logger.Info().Str("title", cleanTitle).Int("chapters", chapterCount).Msg("en-masse: Queueing chapters")

		// Queue chapters with rate limiting
		for _, chapter := range chapterContainer.Chapters {
			// Check for cancellation
			select {
			case <-cancelCh:
				saveState(i, true)
				h.App.WSEventManager.SendEvent(events.WarningToast, "En Masse Downloader stopped by user - progress saved")
				return
			default:
			}

			if waitForOfflineMode(i, "queueing") {
				return
			}
			if throttleForPlayback(i, "queueing", 3*time.Second) {
				return
			}

			for {
				err := h.App.MangaDownloader.DownloadChapter(manga.DownloadChapterOptions{
					Provider:  provider,
					MediaId:   mediaId,
					ChapterId: chapter.ID,
					StartNow:  false, // Don't start immediately, just queue
				})
				if err == nil {
					break
				}

				if handleOfflineError(err, i, "queueing") {
					return
				}
				if isOfflineLikeError(err) {
					continue
				}

				h.App.Logger.Warn().Err(err).Str("chapterId", chapter.ID).Msg("en-masse: Failed to queue chapter")
				break
			}

			// Rate limit between chapter queues (400ms like the normal handler)
			sleepDuration := 400 * time.Millisecond
			if isPlaybackActive() {
				sleepDuration = 2 * time.Second
			}
			time.Sleep(sleepDuration)
		}

		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.ProcessedManga = append(enMasseDownloaderStatus.ProcessedManga, ProcessedMangaInfo{
			Title:        cleanTitle,
			MediaId:      mediaId,
			ChapterCount: chapterCount,
		})
		enMasseDownloaderStatus.QueuedChapterCount += chapterCount
		enMasseDownloaderMu.Unlock()

		// Add manga to the "To Read List" if not already there
		isInList, err := h.App.Database.IsMangaInToReadList(mediaId)
		if err == nil && !isInList {
			if err := h.App.Database.AddMangaToReadItem(mediaId); err != nil {
				h.App.Logger.Warn().Err(err).Int("mediaId", mediaId).Msg("en-masse: Failed to add manga to To Read List")
			} else {
				h.App.Logger.Debug().Int("mediaId", mediaId).Msg("en-masse: Added manga to To Read List")
			}
		}

		h.App.Logger.Info().Str("title", cleanTitle).Int("chapters", chapterCount).Msg("en-masse: Successfully queued manga")

		// Step 4: Wait between manga to avoid rate limiting
		enMasseDownloaderMu.Lock()
		enMasseDownloaderStatus.CurrentPhase = "waiting"
		enMasseDownloaderMu.Unlock()

		// Wait 5 seconds between manga to be safe
		time.Sleep(5 * time.Second)
	}

	// Clear the saved state since we're done
	_ = h.App.Database.DeleteEnMasseDownloaderState()

	h.App.Logger.Info().Msg("en-masse: Finished processing all manga")
}

func (h *Handler) searchMangaOnAnilist(ctx context.Context, title string) (*anilist.BaseManga, error) {
	if h.App.AnilistClientRef == nil || h.App.AnilistClientRef.Get() == nil {
		return nil, errors.New("anilist client is not initialized")
	}

	// Use the AniList client to search for manga
	page := 1
	perPage := 5
	isAdultContentEnabled := h.App.Settings.GetAnilist().EnableAdultContent

	client := shared_platform.NewCacheLayer(h.App.AnilistClientRef)

	result, err := anilist.ListMangaM(
		client,
		&page,
		&title,
		&perPage,
		nil, // sort
		nil, // status
		nil, // genres
		nil, // averageScoreGreater
		nil, // year
		nil, // format
		nil, // countryOfOrigin
		&isAdultContentEnabled, // isAdult
		h.App.Logger,
		"",  // token (use default)
	)
	if err != nil {
		return nil, err
	}

	if result == nil || result.Page == nil || len(result.Page.Media) == 0 {
		return nil, nil
	}

	// Return the first (best) result
	return result.Page.Media[0], nil
}

func cleanMangaTitle(title string) string {
	// Remove newlines and extra whitespace
	// HakuneKo titles sometimes have alternative names after newlines
	for i, c := range title {
		if c == '\n' || c == '\r' {
			return title[:i]
		}
	}
	return title
}
