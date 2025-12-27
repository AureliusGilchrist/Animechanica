package db

import (
	"errors"
	"gorm.io/gorm"
	"seanime/internal/database/models"
)

// GetAnimeEnMasseDownloaderState retrieves the current anime en masse downloader state
func (db *Database) GetAnimeEnMasseDownloaderState() (*models.AnimeEnMasseDownloaderState, error) {
	var state models.AnimeEnMasseDownloaderState
	err := db.gormdb.First(&state).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		db.Logger.Error().Err(err).Msg("db: Failed to get anime en masse downloader state")
		return nil, err
	}
	return &state, nil
}

// SaveAnimeEnMasseDownloaderState saves or updates the anime en masse downloader state
func (db *Database) SaveAnimeEnMasseDownloaderState(state *models.AnimeEnMasseDownloaderState) error {
	// Check if a state already exists
	var existing models.AnimeEnMasseDownloaderState
	err := db.gormdb.First(&existing).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Create new state
			err = db.gormdb.Create(state).Error
			if err != nil {
				db.Logger.Error().Err(err).Msg("db: Failed to create anime en masse downloader state")
				return err
			}
			return nil
		}
		db.Logger.Error().Err(err).Msg("db: Failed to check anime en masse downloader state")
		return err
	}

	// Update existing state
	state.ID = existing.ID
	err = db.gormdb.Save(state).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to update anime en masse downloader state")
		return err
	}
	return nil
}

// DeleteAnimeEnMasseDownloaderState deletes the anime en masse downloader state
func (db *Database) DeleteAnimeEnMasseDownloaderState() error {
	err := db.gormdb.Where("1 = 1").Delete(&models.AnimeEnMasseDownloaderState{}).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to delete anime en masse downloader state")
		return err
	}
	return nil
}

// GetTorrentMediaAssociationsByMediaId returns all torrent-media associations for a specific media ID
func (db *Database) GetTorrentMediaAssociationsByMediaId(mediaId int) ([]*models.TorrentMediaAssociation, error) {
	var associations []*models.TorrentMediaAssociation
	err := db.gormdb.Where("media_id = ?", mediaId).Find(&associations).Error
	if err != nil {
		db.Logger.Error().Err(err).Int("mediaId", mediaId).Msg("db: Failed to get torrent-media associations by media ID")
		return nil, err
	}
	return associations, nil
}
