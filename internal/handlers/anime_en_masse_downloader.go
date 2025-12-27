package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"seanime/internal/database/db_bridge"
	"seanime/internal/database/models"
	"seanime/internal/events"
	"seanime/internal/library/anime"
	hibiketorrent "seanime/internal/extension/hibike/torrent"
	"seanime/internal/torrents/torrent"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	animeOfflineErrorThreshold = 3

	// Minimum seeders required for a torrent to be considered
	MinSeeders = 4
)

// AnilistAnimeEntry represents an anime entry from the AniList minified JSON file
type AnilistAnimeEntry struct {
	ID int `json:"id"`
}

func sanitizeDirectoryName(input string) string {
	re := regexp.MustCompile(`[/\\|\x00-\x1F.!` + "`" + `]`)
	sanitized := re.ReplaceAllString(input, " ")
	sanitized = strings.Trim(sanitized, " .")
	if sanitized == "" {
		return ""
	}
	return sanitized
}

// AnimeEnMasseDownloaderStatus represents the current status of the anime en masse downloader
type AnimeEnMasseDownloaderStatus struct {
	IsRunning          bool                  `json:"isRunning"`
	CurrentAnimeIndex  int                   `json:"currentAnimeIndex"`
	TotalAnimeCount    int                   `json:"totalAnimeCount"`
	CurrentAnimeTitle  string                `json:"currentAnimeTitle"`
	CurrentPhase       string                `json:"currentPhase"` // "fetching", "searching", "downloading", "waiting", "waiting_offline", "idle"
	ProcessedAnime     []ProcessedAnimeInfo  `json:"processedAnime"`
	FailedAnime        []FailedAnimeInfo     `json:"failedAnime"`
	SkippedAnime       []SkippedAnimeInfo    `json:"skippedAnime"`
	IndexFailedAnime   []IndexFailedAnimeInfo `json:"indexFailedAnime"`
	DownloadedCount    int                   `json:"downloadedCount"`
	FilePath           string                `json:"filePath"`
	Provider           string                `json:"provider"`
	CanResume          bool                  `json:"canResume"`
}

type ProcessedAnimeInfo struct {
	Title       string `json:"title"`
	MediaId     int    `json:"mediaId"`
	TorrentName string `json:"torrentName"`
	Seeders     int    `json:"seeders"`
	Resolution  string `json:"resolution"`
}

type FailedAnimeInfo struct {
	Title   string `json:"title"`
	MediaId int    `json:"mediaId"`
	Reason  string `json:"reason"`
}

type SkippedAnimeInfo struct {
	Title   string `json:"title"`
	MediaId int    `json:"mediaId"`
	Reason  string `json:"reason"`
}

type IndexFailedAnimeInfo struct {
	MediaId int    `json:"mediaId"`
	Reason  string `json:"reason"`
}

var (
	animeEnMasseDownloaderMu     sync.Mutex
	animeEnMasseDownloaderStatus = &AnimeEnMasseDownloaderStatus{
		IsRunning:        false,
		ProcessedAnime:   []ProcessedAnimeInfo{},
		FailedAnime:      []FailedAnimeInfo{},
		SkippedAnime:     []SkippedAnimeInfo{},
		IndexFailedAnime: []IndexFailedAnimeInfo{},
	}
	animeEnMasseDownloaderCancelCh chan struct{}
)

// HandleGetAnimeEnMasseDownloaderStatus
//
//	@summary returns the current status of the anime en masse downloader.
//	@route /api/v1/anime/en-masse/status [GET]
//	@returns AnimeEnMasseDownloaderStatus
func (h *Handler) HandleGetAnimeEnMasseDownloaderStatus(c echo.Context) error {
	animeEnMasseDownloaderMu.Lock()
	defer animeEnMasseDownloaderMu.Unlock()

	// Check if there's a saved state to resume from
	savedState, err := h.App.Database.GetAnimeEnMasseDownloaderState()
	if err == nil && savedState != nil && savedState.IsActive && !animeEnMasseDownloaderStatus.IsRunning {
		animeEnMasseDownloaderStatus.CanResume = true
		animeEnMasseDownloaderStatus.FilePath = savedState.FilePath
		animeEnMasseDownloaderStatus.Provider = savedState.Provider
		animeEnMasseDownloaderStatus.CurrentAnimeIndex = savedState.CurrentIndex
		animeEnMasseDownloaderStatus.TotalAnimeCount = savedState.TotalCount
		animeEnMasseDownloaderStatus.DownloadedCount = savedState.DownloadedCount

		// Restore processed, failed, and skipped anime from JSON
		if len(savedState.ProcessedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.ProcessedAnimeJSON, &animeEnMasseDownloaderStatus.ProcessedAnime)
		}
		if len(savedState.FailedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.FailedAnimeJSON, &animeEnMasseDownloaderStatus.FailedAnime)
		}
		if len(savedState.SkippedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.SkippedAnimeJSON, &animeEnMasseDownloaderStatus.SkippedAnime)
		}
		if len(savedState.IndexFailedJSON) > 0 {
			_ = json.Unmarshal(savedState.IndexFailedJSON, &animeEnMasseDownloaderStatus.IndexFailedAnime)
		}
	} else {
		animeEnMasseDownloaderStatus.CanResume = false
	}

	return h.RespondWithData(c, animeEnMasseDownloaderStatus)
}

// HandleLoadAnilistFile
//
//	@summary loads and parses an AniList anime ID file.
//	@route /api/v1/anime/en-masse/load-file [POST]
//	@returns []int
func (h *Handler) HandleLoadAnilistFile(c echo.Context) error {
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

	// Parse the JSON - the file contains a "deadEntries" array of string IDs
	var fileData struct {
		DeadEntries []string `json:"deadEntries"`
	}
	if err := json.Unmarshal(data, &fileData); err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to parse file: %w", err))
	}

	// Convert string IDs to integers
	ids := make([]int, 0, len(fileData.DeadEntries))
	for _, idStr := range fileData.DeadEntries {
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err == nil && id > 0 {
			ids = append(ids, id)
		}
	}

	return h.RespondWithData(c, ids)
}

// HandleStartAnimeEnMasseDownloader
//
//	@summary starts the anime en masse downloader process.
//	@desc This will fetch each anime from AniList, search for batch torrents, and download the best one.
//	@desc If resume is true and there's a saved state, it will resume from where it left off.
//	@route /api/v1/anime/en-masse/start [POST]
//	@returns bool
func (h *Handler) HandleStartAnimeEnMasseDownloader(c echo.Context) error {
	type body struct {
		FilePath    string `json:"filePath"`
		Provider    string `json:"provider"`
		Destination string `json:"destination"`
		Resume      bool   `json:"resume"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	animeEnMasseDownloaderMu.Lock()
	if animeEnMasseDownloaderStatus.IsRunning {
		animeEnMasseDownloaderMu.Unlock()
		return h.RespondWithError(c, errors.New("anime en masse downloader is already running"))
	}
	animeEnMasseDownloaderMu.Unlock()

	var animeIds []int
	var startIndex int
	var processedAnime []ProcessedAnimeInfo
	var failedAnime []FailedAnimeInfo
	var skippedAnime []SkippedAnimeInfo
	var downloadedCount int
	var baseDestination string
	var indexFailedAnime []IndexFailedAnimeInfo

	// Check if we should resume from saved state
	if b.Resume {
		savedState, err := h.App.Database.GetAnimeEnMasseDownloaderState()
		if err != nil || savedState == nil || !savedState.IsActive {
			return h.RespondWithError(c, errors.New("no saved state to resume from"))
		}

		b.FilePath = savedState.FilePath
		b.Provider = savedState.Provider
		baseDestination = savedState.Destination
		startIndex = savedState.CurrentIndex
		downloadedCount = savedState.DownloadedCount

		// Restore processed, failed, and skipped anime
		if len(savedState.ProcessedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.ProcessedAnimeJSON, &processedAnime)
		}
		if len(savedState.FailedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.FailedAnimeJSON, &failedAnime)
		}
		if len(savedState.SkippedAnimeJSON) > 0 {
			_ = json.Unmarshal(savedState.SkippedAnimeJSON, &skippedAnime)
		}
		if len(savedState.IndexFailedJSON) > 0 {
			_ = json.Unmarshal(savedState.IndexFailedJSON, &indexFailedAnime)
		}
	} else {
		baseDestination = b.Destination
	}

	baseDestination = strings.TrimSpace(baseDestination)

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
	var fileData struct {
		DeadEntries []string `json:"deadEntries"`
	}
	if err := json.Unmarshal(data, &fileData); err != nil {
		return h.RespondWithError(c, fmt.Errorf("failed to parse file: %w", err))
	}

	// Convert string IDs to integers
	for _, idStr := range fileData.DeadEntries {
		var id int
		if _, err := fmt.Sscanf(idStr, "%d", &id); err == nil && id > 0 {
			animeIds = append(animeIds, id)
		}
	}

	// Start the downloader in a goroutine
	go h.runAnimeEnMasseDownloader(animeIds, b.Provider, b.FilePath, baseDestination, startIndex, processedAnime, failedAnime, skippedAnime, indexFailedAnime, downloadedCount)

	return h.RespondWithData(c, true)
}

// HandleStopAnimeEnMasseDownloader
//
//	@summary stops the anime en masse downloader process.
//	@route /api/v1/anime/en-masse/stop [POST]
//	@returns bool
func (h *Handler) HandleStopAnimeEnMasseDownloader(c echo.Context) error {
	animeEnMasseDownloaderMu.Lock()
	defer animeEnMasseDownloaderMu.Unlock()

	if !animeEnMasseDownloaderStatus.IsRunning {
		return h.RespondWithError(c, errors.New("anime en masse downloader is not running"))
	}

	// Signal cancellation
	if animeEnMasseDownloaderCancelCh != nil {
		select {
		case <-animeEnMasseDownloaderCancelCh:
			// already closed
		default:
			close(animeEnMasseDownloaderCancelCh)
		}
		animeEnMasseDownloaderCancelCh = nil
		animeEnMasseDownloaderStatus.CurrentPhase = "stopping"
	}

	return h.RespondWithData(c, true)
}

// HandleResetAnimeEnMasseDownloader
//
//	@summary resets the anime en masse downloader status.
//	@route /api/v1/anime/en-masse/reset [POST]
//	@returns bool
func (h *Handler) HandleResetAnimeEnMasseDownloader(c echo.Context) error {
	animeEnMasseDownloaderMu.Lock()
	defer animeEnMasseDownloaderMu.Unlock()

	if animeEnMasseDownloaderStatus.IsRunning {
		return h.RespondWithError(c, errors.New("cannot reset while downloader is running"))
	}

	// Clear the saved state from database
	_ = h.App.Database.DeleteAnimeEnMasseDownloaderState()

	animeEnMasseDownloaderStatus = &AnimeEnMasseDownloaderStatus{
		IsRunning:        false,
		ProcessedAnime:   []ProcessedAnimeInfo{},
		FailedAnime:      []FailedAnimeInfo{},
		SkippedAnime:     []SkippedAnimeInfo{},
		IndexFailedAnime: []IndexFailedAnimeInfo{},
	}

	return h.RespondWithData(c, true)
}

func (h *Handler) runAnimeEnMasseDownloader(
	animeIds []int,
	provider string,
	filePath string,
	baseDestination string,
	startIndex int,
	processedAnime []ProcessedAnimeInfo,
	failedAnime []FailedAnimeInfo,
	skippedAnime []SkippedAnimeInfo,
	indexFailedAnime []IndexFailedAnimeInfo,
	downloadedCount int,
) {
	if processedAnime == nil {
		processedAnime = []ProcessedAnimeInfo{}
	}
	if failedAnime == nil {
		failedAnime = []FailedAnimeInfo{}
	}
	if skippedAnime == nil {
		skippedAnime = []SkippedAnimeInfo{}
	}

	animeEnMasseDownloaderMu.Lock()
	animeEnMasseDownloaderStatus = &AnimeEnMasseDownloaderStatus{
		IsRunning:         true,
		CurrentAnimeIndex: startIndex,
		TotalAnimeCount:   len(animeIds),
		CurrentPhase:      "idle",
		ProcessedAnime:    processedAnime,
		FailedAnime:       failedAnime,
		SkippedAnime:      skippedAnime,
		IndexFailedAnime:  indexFailedAnime,
		DownloadedCount:   downloadedCount,
		FilePath:          filePath,
		Provider:          provider,
	}
	animeEnMasseDownloaderCancelCh = make(chan struct{})
	animeEnMasseDownloaderMu.Unlock()

	cancelCh := animeEnMasseDownloaderCancelCh

	// Helper function to save state to database
	saveState := func(currentIndex int, isActive bool) {
		animeEnMasseDownloaderMu.Lock()
		processedJSON, _ := json.Marshal(animeEnMasseDownloaderStatus.ProcessedAnime)
		failedJSON, _ := json.Marshal(animeEnMasseDownloaderStatus.FailedAnime)
		skippedJSON, _ := json.Marshal(animeEnMasseDownloaderStatus.SkippedAnime)
		indexFailedJSON, _ := json.Marshal(animeEnMasseDownloaderStatus.IndexFailedAnime)
		state := &models.AnimeEnMasseDownloaderState{
			FilePath:           filePath,
			Provider:           provider,
			Destination:        baseDestination,
			CurrentIndex:       currentIndex,
			TotalCount:         len(animeIds),
			ProcessedAnimeJSON: processedJSON,
			FailedAnimeJSON:    failedJSON,
			SkippedAnimeJSON:   skippedJSON,
			IndexFailedJSON:    indexFailedJSON,
			DownloadedCount:    animeEnMasseDownloaderStatus.DownloadedCount,
			IsActive:           isActive,
		}
		animeEnMasseDownloaderMu.Unlock()
		_ = h.App.Database.SaveAnimeEnMasseDownloaderState(state)
	}

	defer func() {
		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.IsRunning = false
		animeEnMasseDownloaderStatus.CurrentPhase = "idle"
		animeEnMasseDownloaderMu.Unlock()
		h.App.WSEventManager.SendEvent(events.SuccessToast, "Anime En Masse Downloader finished")
	}()

	if startIndex > 0 {
		h.App.WSEventManager.SendEvent(events.InfoToast, fmt.Sprintf("Resuming Anime En Masse Downloader from anime %d/%d", startIndex+1, len(animeIds)))
	} else {
		h.App.WSEventManager.SendEvent(events.InfoToast, fmt.Sprintf("Starting Anime En Masse Downloader for %d anime", len(animeIds)))
	}

	ctx := context.Background()

	localFilesByMedia := make(map[int][]*anime.LocalFile)
	if lfs, _, err := db_bridge.GetLocalFiles(h.App.Database); err == nil {
		localFilesByMedia = anime.GroupLocalFilesByMediaID(lfs)
	}

	var libraryRoots []string
	if h.App.Settings != nil && h.App.Settings.GetLibrary() != nil {
		libSettings := h.App.Settings.GetLibrary()
		if libSettings.LibraryPath != "" {
			libraryRoots = append(libraryRoots, libSettings.LibraryPath)
		}
		if len(libSettings.LibraryPaths) > 0 {
			libraryRoots = append(libraryRoots, libSettings.LibraryPaths...)
		}
	}

	resolveDestination := func(mediaTitle string, mediaId int) string {
		if files, ok := localFilesByMedia[mediaId]; ok && len(files) > 0 {
			if last := files[len(files)-1]; last != nil && last.Path != "" {
				return filepath.Clean(filepath.Dir(last.Path))
			}
		}

		title := sanitizeDirectoryName(mediaTitle)
		if title == "" {
			title = fmt.Sprintf("Anime_%d", mediaId)
		}

		root := strings.TrimSpace(baseDestination)
		if root == "" {
			for _, candidate := range libraryRoots {
				candidate = strings.TrimSpace(candidate)
				if candidate != "" {
					root = candidate
					break
				}
			}
		}
		if root == "" {
			root = filepath.Join(os.TempDir(), "seanime-anime")
		}

		return filepath.Join(root, title)
	}

	updateStatus := func(mutator func(*AnimeEnMasseDownloaderStatus)) {
		animeEnMasseDownloaderMu.Lock()
		defer animeEnMasseDownloaderMu.Unlock()
		mutator(animeEnMasseDownloaderStatus)
	}

	addIndexFailure := func(mediaId int, reason string) {
		updateStatus(func(status *AnimeEnMasseDownloaderStatus) {
			status.IndexFailedAnime = append(status.IndexFailedAnime, IndexFailedAnimeInfo{
				MediaId: mediaId,
				Reason:  reason,
			})
		})
	}

	waitForOfflineMode := func(currentIndex int, resumePhase string) bool {
		if !h.App.IsOffline() {
			return false
		}

		h.App.Logger.Warn().Msg("anime-en-masse: App offline, pausing downloader")
		for h.App.IsOffline() {
			updateStatus(func(status *AnimeEnMasseDownloaderStatus) {
				status.CurrentPhase = "waiting_offline"
			})

			select {
			case <-cancelCh:
				saveState(currentIndex, true)
				h.App.WSEventManager.SendEvent(events.WarningToast, "Anime En Masse Downloader stopped by user - progress saved")
				return true
			case <-time.After(5 * time.Second):
			}
		}

		updateStatus(func(status *AnimeEnMasseDownloaderStatus) {
			if resumePhase != "" {
				status.CurrentPhase = resumePhase
			} else if status.CurrentPhase == "waiting_offline" {
				status.CurrentPhase = "idle"
			}
		})

		h.App.Logger.Info().Msg("anime-en-masse: Offline mode cleared, resuming downloader")
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

	cooldownAfterOfflineError := func(reason string, currentIndex int, resumePhase string) bool {
		updateStatus(func(status *AnimeEnMasseDownloaderStatus) {
			status.CurrentPhase = "waiting_offline"
		})

		h.App.Logger.Warn().Str("reason", reason).Msg("anime-en-masse: Connection issues detected, backing off")

		select {
		case <-cancelCh:
			saveState(currentIndex, true)
			h.App.WSEventManager.SendEvent(events.WarningToast, "Anime En Masse Downloader stopped by user - progress saved")
			return true
		case <-time.After(10 * time.Second):
		}

		updateStatus(func(status *AnimeEnMasseDownloaderStatus) {
			if resumePhase != "" {
				status.CurrentPhase = resumePhase
			} else if status.CurrentPhase == "waiting_offline" {
				status.CurrentPhase = "idle"
			}
		})
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
		if offlineErrorCount < animeOfflineErrorThreshold {
			return false
		}

		offlineErrorCount = 0
		return cooldownAfterOfflineError(err.Error(), currentIndex, resumePhase)
	}

	// Check if torrent is already downloading or downloaded for this media
	isTorrentAlreadyAssociated := func(mediaId int) bool {
		associations, err := h.App.Database.GetTorrentMediaAssociationsByMediaId(mediaId)
		if err != nil {
			return false
		}
		return len(associations) > 0
	}

	// Check if torrent is currently downloading
	isTorrentDownloading := func(mediaId int) bool {
		associations, err := h.App.Database.GetTorrentMediaAssociationsByMediaId(mediaId)
		if err != nil {
			return false
		}

		if len(associations) == 0 {
			return false
		}

		// Check if any of the associated torrents are currently active
		torrents, err := h.App.TorrentClientRepository.GetActiveTorrents()
		if err != nil {
			return false
		}

		for _, assoc := range associations {
			for _, t := range torrents {
				if strings.EqualFold(t.Hash, assoc.InfoHash) {
					return true
				}
			}
		}

		return false
	}

	// Score a torrent based on preferences (higher is better)
	scoreTorrent := func(t *hibiketorrent.AnimeTorrent) int {
		score := 0
		name := strings.ToLower(t.Name)

		// Prefer Dual Audio or Multi Audio
		if strings.Contains(name, "dual audio") || strings.Contains(name, "dual-audio") {
			score += 100
		}
		if strings.Contains(name, "multi audio") || strings.Contains(name, "multi-audio") {
			score += 100
		}

		// Prefer higher resolution
		if strings.Contains(name, "2160p") || strings.Contains(name, "4k") {
			score += 50
		} else if strings.Contains(name, "1080p") {
			score += 40
		} else if strings.Contains(name, "720p") {
			score += 20
		}

		// Add seeders as a factor (but not too much)
		score += t.Seeders / 10

		return score
	}

	// Find the best torrent from search results
	findBestTorrent := func(torrents []*hibiketorrent.AnimeTorrent) *hibiketorrent.AnimeTorrent {
		var bestTorrent *hibiketorrent.AnimeTorrent
		bestScore := -1

		for _, t := range torrents {
			// Skip torrents with insufficient seeders
			if t.Seeders < MinSeeders {
				continue
			}

			score := scoreTorrent(t)
			if score > bestScore {
				bestScore = score
				bestTorrent = t
			}
		}

		return bestTorrent
	}

	for i := startIndex; i < len(animeIds); i++ {
		mediaId := animeIds[i]

		if waitForOfflineMode(i, "fetching") {
			return
		}

		// Check for cancellation
		select {
		case <-cancelCh:
			saveState(i, true)
			h.App.WSEventManager.SendEvent(events.WarningToast, "Anime En Masse Downloader stopped by user - progress saved")
			return
		default:
		}

		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.CurrentAnimeIndex = i + 1
		animeEnMasseDownloaderStatus.CurrentAnimeTitle = fmt.Sprintf("Media ID: %d", mediaId)
		animeEnMasseDownloaderStatus.CurrentPhase = "fetching"
		animeEnMasseDownloaderMu.Unlock()

		// Save state periodically
		saveState(i, true)

		h.App.Logger.Info().Int("mediaId", mediaId).Int("index", i+1).Int("total", len(animeIds)).Msg("anime-en-masse: Processing anime")

		// Step 1: Check if torrent is already associated with this anime
		if isTorrentAlreadyAssociated(mediaId) {
			h.App.Logger.Info().Int("mediaId", mediaId).Msg("anime-en-masse: Torrent already associated, skipping")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.SkippedAnime = append(animeEnMasseDownloaderStatus.SkippedAnime, SkippedAnimeInfo{
				MediaId: mediaId,
				Reason:  "Torrent already associated",
			})
			animeEnMasseDownloaderMu.Unlock()
			// Rate limit - respect AniList throttle
			time.Sleep(1 * time.Second)
			continue
		}

		// Step 2: Check if torrent is currently downloading
		if isTorrentDownloading(mediaId) {
			h.App.Logger.Info().Int("mediaId", mediaId).Msg("anime-en-masse: Torrent already downloading, skipping")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.SkippedAnime = append(animeEnMasseDownloaderStatus.SkippedAnime, SkippedAnimeInfo{
				MediaId: mediaId,
				Reason:  "Torrent already downloading",
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(1 * time.Second)
			continue
		}

		// Step 3: Fetch anime details from AniList
	fetchRetry:
		media, err := h.App.AnilistPlatformRef.Get().GetAnime(ctx, mediaId)
		if err != nil {
			if handleOfflineError(err, i, "fetching") {
				return
			}
			if isOfflineLikeError(err) {
				goto fetchRetry
			}
			h.App.Logger.Warn().Err(err).Int("mediaId", mediaId).Msg("anime-en-masse: Failed to fetch anime from AniList")
			addIndexFailure(mediaId, fmt.Sprintf("Failed to fetch from AniList: %v", err))
			// Rate limit - respect AniList throttle (2 seconds between requests)
			time.Sleep(2 * time.Second)
			continue
		}

		if media == nil {
			h.App.Logger.Warn().Int("mediaId", mediaId).Msg("anime-en-masse: Anime not found on AniList")
			addIndexFailure(mediaId, "Anime not found on AniList")
			time.Sleep(2 * time.Second)
			continue
		}

		animeTitle := media.GetRomajiTitleSafe()
		if media.GetTitle().GetEnglish() != nil && *media.GetTitle().GetEnglish() != "" {
			animeTitle = *media.GetTitle().GetEnglish()
		}

		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.CurrentAnimeTitle = animeTitle
		animeEnMasseDownloaderStatus.CurrentPhase = "searching"
		animeEnMasseDownloaderMu.Unlock()

		h.App.Logger.Info().Str("title", animeTitle).Int("mediaId", mediaId).Msg("anime-en-masse: Found anime on AniList")

		// Step 4: Search for batch torrents
		// Rate limit before searching
		time.Sleep(1 * time.Second)

	searchRetry:
		searchData, err := h.App.TorrentRepository.SearchAnime(ctx, torrent.AnimeSearchOptions{
			Provider:      provider,
			Type:          torrent.AnimeSearchTypeSmart,
			Media:         media,
			Query:         "",
			Batch:         true, // Search for batch/complete series
			EpisodeNumber: 0,
			BestReleases:  true,
			Resolution:    "", // We'll filter by resolution ourselves
		})
		if err != nil {
			if handleOfflineError(err, i, "searching") {
				return
			}
			if isOfflineLikeError(err) {
				goto searchRetry
			}
			h.App.Logger.Warn().Err(err).Str("title", animeTitle).Msg("anime-en-masse: Failed to search for torrents")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  fmt.Sprintf("Torrent search failed: %v", err),
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		if searchData == nil || len(searchData.Torrents) == 0 {
			h.App.Logger.Warn().Str("title", animeTitle).Msg("anime-en-masse: No torrents found")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  "No torrents found",
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		// Step 5: Find the best torrent
		bestTorrent := findBestTorrent(searchData.Torrents)
		if bestTorrent == nil {
			h.App.Logger.Warn().Str("title", animeTitle).Msg("anime-en-masse: No suitable torrents found (insufficient seeders)")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  fmt.Sprintf("No torrents with >%d seeders found", MinSeeders-1),
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		h.App.Logger.Info().
			Str("title", animeTitle).
			Str("torrent", bestTorrent.Name).
			Int("seeders", bestTorrent.Seeders).
			Msg("anime-en-masse: Found best torrent")

		// Step 6: Determine destination and download the torrent
		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.CurrentPhase = "downloading"
		animeEnMasseDownloaderMu.Unlock()

		destination := resolveDestination(animeTitle, mediaId)
		if err := os.MkdirAll(destination, 0o755); err != nil {
			h.App.Logger.Warn().Err(err).Str("destination", destination).Msg("anime-en-masse: Failed to ensure destination directory")
		}

		// Get the magnet link
		providerExtension, ok := h.App.TorrentRepository.GetAnimeProviderExtension(provider)
		if !ok {
			h.App.Logger.Warn().Str("title", animeTitle).Msg("anime-en-masse: Provider extension not found")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  "Provider extension not found",
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		magnet, err := providerExtension.GetProvider().GetTorrentMagnetLink(bestTorrent)
		if err != nil {
			h.App.Logger.Warn().Err(err).Str("title", animeTitle).Msg("anime-en-masse: Failed to get magnet link")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  fmt.Sprintf("Failed to get magnet link: %v", err),
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		// Try to start torrent client if it's not running
		ok = h.App.TorrentClientRepository.Start()
		if !ok {
			h.App.Logger.Warn().Str("title", animeTitle).Msg("anime-en-masse: Could not start torrent client")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  "Could not start torrent client",
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		// Add the torrent
		err = h.App.TorrentClientRepository.AddMagnets([]string{magnet}, destination)
		if err != nil {
			h.App.Logger.Warn().Err(err).Str("title", animeTitle).Msg("anime-en-masse: Failed to add torrent")
			animeEnMasseDownloaderMu.Lock()
			animeEnMasseDownloaderStatus.FailedAnime = append(animeEnMasseDownloaderStatus.FailedAnime, FailedAnimeInfo{
				Title:   animeTitle,
				MediaId: mediaId,
				Reason:  fmt.Sprintf("Failed to add torrent: %v", err),
			})
			animeEnMasseDownloaderMu.Unlock()
			time.Sleep(2 * time.Second)
			continue
		}

		// Save pre-match association for accurate file matching
		err = h.App.Database.SaveTorrentPreMatch(destination, mediaId)
		if err != nil {
			h.App.Logger.Warn().Err(err).Msg("anime-en-masse: Failed to save torrent pre-match")
		}

		// Save torrent hash -> media ID association for download tracking
		if bestTorrent.InfoHash != "" {
			err = h.App.Database.SaveTorrentMediaAssociation(bestTorrent.InfoHash, mediaId)
			if err != nil {
				h.App.Logger.Warn().Err(err).Str("hash", bestTorrent.InfoHash).Msg("anime-en-masse: Failed to save torrent-media association")
			}
		}

		h.App.Logger.Info().Str("title", animeTitle).Str("torrent", bestTorrent.Name).Msg("anime-en-masse: Successfully added torrent")

		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.ProcessedAnime = append(animeEnMasseDownloaderStatus.ProcessedAnime, ProcessedAnimeInfo{
			Title:       animeTitle,
			MediaId:     mediaId,
			TorrentName: bestTorrent.Name,
			Seeders:     bestTorrent.Seeders,
			Resolution:  bestTorrent.Resolution,
		})
		animeEnMasseDownloaderStatus.DownloadedCount++
		animeEnMasseDownloaderMu.Unlock()

		// Step 7: Wait between anime to avoid rate limiting
		animeEnMasseDownloaderMu.Lock()
		animeEnMasseDownloaderStatus.CurrentPhase = "waiting"
		animeEnMasseDownloaderMu.Unlock()

		// Wait 3 seconds between anime to respect AniList rate limits
		time.Sleep(3 * time.Second)
	}

	// Clear the saved state since we're done
	_ = h.App.Database.DeleteAnimeEnMasseDownloaderState()

	h.App.Logger.Info().Msg("anime-en-masse: Finished processing all anime")
}
