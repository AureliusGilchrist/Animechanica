package db

import (
	"errors"
	"gorm.io/gorm"
	"seanime/internal/database/models"
)

// GetEnMasseDownloaderState retrieves the current en masse downloader state
func (db *Database) GetEnMasseDownloaderState() (*models.EnMasseDownloaderState, error) {
	var state models.EnMasseDownloaderState
	err := db.gormdb.First(&state).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		db.Logger.Error().Err(err).Msg("db: Failed to get en masse downloader state")
		return nil, err
	}
	return &state, nil
}

// SaveEnMasseDownloaderState saves or updates the en masse downloader state
func (db *Database) SaveEnMasseDownloaderState(state *models.EnMasseDownloaderState) error {
	// Check if a state already exists
	var existing models.EnMasseDownloaderState
	err := db.gormdb.First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Create new state
			err = db.gormdb.Create(state).Error
			if err != nil {
				db.Logger.Error().Err(err).Msg("db: Failed to create en masse downloader state")
				return err
			}
			return nil
		}
		db.Logger.Error().Err(err).Msg("db: Failed to check en masse downloader state")
		return err
	}

	// Update existing state
	state.ID = existing.ID
	err = db.gormdb.Save(state).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to update en masse downloader state")
		return err
	}
	return nil
}

// DeleteEnMasseDownloaderState deletes the en masse downloader state
func (db *Database) DeleteEnMasseDownloaderState() error {
	err := db.gormdb.Where("1 = 1").Delete(&models.EnMasseDownloaderState{}).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to delete en masse downloader state")
		return err
	}
	return nil
}

// GetDistinctMediaIdsInDownloadQueue returns the count of distinct media IDs in the download queue
func (db *Database) GetDistinctMediaIdsInDownloadQueue() (int64, error) {
	var count int64
	err := db.gormdb.Model(&models.ChapterDownloadQueueItem{}).
		Distinct("media_id").
		Count(&count).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to count distinct media IDs in download queue")
		return 0, err
	}
	return count, nil
}

// GetQueuedChapterCountForMedia returns the count of queued chapters for a specific media
func (db *Database) GetQueuedChapterCountForMedia(mediaId int) (int64, error) {
	var count int64
	err := db.gormdb.Model(&models.ChapterDownloadQueueItem{}).
		Where("media_id = ?", mediaId).
		Count(&count).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to count queued chapters for media")
		return 0, err
	}
	return count, nil
}
