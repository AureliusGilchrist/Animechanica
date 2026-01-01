package handlers

import (
	"context"
	"sort"

	"seanime/internal/api/anilist"
	"seanime/internal/database/db_bridge"
	"seanime/internal/library/anime"

	"github.com/labstack/echo/v4"
	"github.com/samber/lo"
)

type SeriesEntry struct {
	Media          *anilist.CompleteAnime `json:"media"`
	DownloadInfo   *DownloadInfo         `json:"downloadInfo"`
	LibraryData    *SeriesLibraryData     `json:"libraryData,omitempty"`
}

type DownloadInfo struct {
	EpisodeCount   int `json:"episodeCount"`
	Downloaded     int `json:"downloaded"`
	NotDownloaded  int `json:"notDownloaded"`
}

type SeriesLibraryData struct {
	HasLocalFiles bool `json:"hasLocalFiles"`
	FileCount     int  `json:"fileCount"`
}

// HandleGetAllSeries
//
//	@summary returns all series (first entries of each franchise)
//	@desc This returns the first entry of every anime franchise in the user's collection.
//	@desc It uses AniList relations to find the earliest related entry.
//	@route /api/v1/library/series [GET]
//	@returns []SeriesEntry
func (h *Handler) HandleGetAllSeries(c echo.Context) error {

	animeCollection, err := h.App.AnilistPlatformRef.Get().GetAnimeCollectionWithRelations(c.Request().Context())
	if err != nil {
		return h.RespondWithError(c, err)
	}

	if animeCollection == nil {
		return h.RespondWithData(c, []*SeriesEntry{})
	}

	// Get all media from the collection
	allMediaMap := make(map[int]*anilist.CompleteAnime)
	for _, list := range animeCollection.GetMediaListCollection().GetLists() {
		for _, entry := range list.GetEntries() {
			media := entry.GetMedia()
			if media != nil {
				allMediaMap[media.GetID()] = media
			}
		}
	}

	// Find the first entry for each franchise
	firstEntries := h.findFirstEntriesForAllFranchises(c.Request().Context(), allMediaMap)

	// Get local files for library data
	lfs, _, err := db_bridge.GetLocalFiles(h.App.Database)
	if err != nil {
		h.App.Logger.Warn().Err(err).Msg("anime series: Failed to get local files")
	}

	// Build file count map
	fileCountMap := make(map[int]int)
	if lfs != nil {
		for _, lf := range lfs {
			if lf.MediaId > 0 {
				fileCountMap[lf.MediaId]++
			}
		}
	}

	// Build response
	seriesEntries := make([]*SeriesEntry, 0, len(firstEntries))
	for _, media := range firstEntries {
		entry := &SeriesEntry{
			Media: media,
		}

		// Add library data if files exist
		fileCount := fileCountMap[media.GetID()]
		if fileCount > 0 {
			entry.LibraryData = &SeriesLibraryData{
				HasLocalFiles: true,
				FileCount:     fileCount,
			}
		}

		// Get download info using the existing EntryDownloadInfo
		downloadInfo, err := anime.NewEntryDownloadInfo(&anime.NewEntryDownloadInfoOptions{
			LocalFiles:          nil, // We don't need local files for basic download info
			AnimeMetadata:       nil, // We don't have metadata provider here
			Media:               media.ToBaseAnime(),
			Progress:            nil, // We don't have progress info
			Status:              nil, // We don't have status info
			MetadataProviderRef: nil, // We don't have metadata provider here
		})
		if err == nil && downloadInfo != nil {
			// Calculate basic stats from episodes
			totalEpisodes := len(downloadInfo.EpisodesToDownload)
			downloaded := 0
			notDownloaded := totalEpisodes
			
			entry.DownloadInfo = &DownloadInfo{
				EpisodeCount:   totalEpisodes,
				Downloaded:     downloaded,
				NotDownloaded:  notDownloaded,
			}
		}

		seriesEntries = append(seriesEntries, entry)
	}

	// Sort by title
	sort.Slice(seriesEntries, func(i, j int) bool {
		titleI := seriesEntries[i].Media.GetPreferredTitle()
		titleJ := seriesEntries[j].Media.GetPreferredTitle()
		return titleI < titleJ
	})

	return h.RespondWithData(c, seriesEntries)
}

// findFirstEntriesForAllFranchises finds the first entry for each franchise
func (h *Handler) findFirstEntriesForAllFranchises(ctx context.Context, allMediaMap map[int]*anilist.CompleteAnime) []*anilist.CompleteAnime {
	visited := make(map[int]bool)
	firstEntries := make(map[int]*anilist.CompleteAnime)

	for mediaId, media := range allMediaMap {
		if visited[mediaId] {
			continue
		}

		// Find the first entry in this franchise
		firstEntry := h.findFirstEntryInFranchise(ctx, media, allMediaMap, visited)
		if firstEntry != nil {
			// Use the first entry's ID as the franchise key
			firstEntries[firstEntry.GetID()] = firstEntry
		}
	}

	// Convert map to slice
	result := make([]*anilist.CompleteAnime, 0, len(firstEntries))
	for _, entry := range firstEntries {
		result = append(result, entry)
	}

	return result
}

// findFirstEntryInFranchise traverses the relation tree to find the earliest entry
func (h *Handler) findFirstEntryInFranchise(ctx context.Context, media *anilist.CompleteAnime, allMediaMap map[int]*anilist.CompleteAnime, visited map[int]bool) *anilist.CompleteAnime {
	if media == nil {
		return nil
	}

	visited[media.GetID()] = true

	// Look for prequels
	relations := media.GetRelations()
	if relations == nil {
		return media
	}

	edges := relations.GetEdges()
	if len(edges) == 0 {
		return media
	}

	// Find all prequels that are in the user's collection
	prequels := lo.Filter(edges, func(edge *anilist.CompleteAnime_Relations_Edges, _ int) bool {
		if edge.GetRelationType() == nil {
			return false
		}
		relType := *edge.GetRelationType()
		node := edge.GetNode()
		if node == nil {
			return false
		}
		// Check if it's a prequel and in the user's collection
		return relType == anilist.MediaRelationPrequel && allMediaMap[node.GetID()] != nil
	})

	if len(prequels) == 0 {
		return media
	}

	// Find the earliest prequel by start date
	var earliestPrequel *anilist.CompleteAnime
	var earliestDate *anilist.CompleteAnime_StartDate

	for _, prequelEdge := range prequels {
		node := prequelEdge.GetNode()
		if node == nil {
			continue
		}

		// Get the full media from our collection
		prequelMedia, ok := allMediaMap[node.GetID()]
		if !ok || visited[node.GetID()] {
			continue
		}

		startDate := prequelMedia.GetStartDate()
		
		// If we don't have an earliest yet, use this one
		if earliestPrequel == nil {
			earliestPrequel = prequelMedia
			earliestDate = startDate
			continue
		}

		// Compare dates if both have them
		if startDate != nil && earliestDate != nil {
			if compareDates(startDate, earliestDate) < 0 {
				earliestPrequel = prequelMedia
				earliestDate = startDate
			}
		} else if startDate != nil && earliestDate == nil {
			// Prefer the one with a date
			earliestPrequel = prequelMedia
			earliestDate = startDate
		}
	}

	// If we found a prequel, recursively search from it
	if earliestPrequel != nil {
		return h.findFirstEntryInFranchise(ctx, earliestPrequel, allMediaMap, visited)
	}

	return media
}

// compareDates compares two start dates, returns -1 if a < b, 0 if equal, 1 if a > b
func compareDates(a, b *anilist.CompleteAnime_StartDate) int {
	aYear := a.GetYear()
	bYear := b.GetYear()
	
	if aYear == nil && bYear == nil {
		return 0
	}
	if aYear == nil {
		return 1 // no date is considered "later"
	}
	if bYear == nil {
		return -1
	}
	
	if *aYear != *bYear {
		if *aYear < *bYear {
			return -1
		}
		return 1
	}
	
	// Years are equal, compare months
	aMonth := a.GetMonth()
	bMonth := b.GetMonth()
	
	if aMonth == nil && bMonth == nil {
		return 0
	}
	if aMonth == nil {
		return 1
	}
	if bMonth == nil {
		return -1
	}
	
	if *aMonth != *bMonth {
		if *aMonth < *bMonth {
			return -1
		}
		return 1
	}
	
	// Months are equal, compare days
	aDay := a.GetDay()
	bDay := b.GetDay()
	
	if aDay == nil && bDay == nil {
		return 0
	}
	if aDay == nil {
		return 1
	}
	if bDay == nil {
		return -1
	}
	
	if *aDay < *bDay {
		return -1
	}
	if *aDay > *bDay {
		return 1
	}
	
	return 0
}
