package db

import (
	"seanime/internal/database/models"
)

// GetMangaToReadList returns all manga IDs in the to-read list
func (db *Database) GetMangaToReadList() ([]*models.MangaToReadItem, error) {
	var items []*models.MangaToReadItem
	err := db.gormdb.Order("created_at DESC").Find(&items).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to get manga to-read list")
		return nil, err
	}
	return items, nil
}

// AddMangaToReadItem adds a manga to the to-read list
func (db *Database) AddMangaToReadItem(mediaId int) error {
	item := &models.MangaToReadItem{
		MediaID: mediaId,
	}
	err := db.gormdb.Create(item).Error
	if err != nil {
		db.Logger.Error().Err(err).Int("mediaId", mediaId).Msg("db: Failed to add manga to to-read list")
		return err
	}
	return nil
}

// RemoveMangaToReadItem removes a manga from the to-read list
func (db *Database) RemoveMangaToReadItem(mediaId int) error {
	err := db.gormdb.Where("media_id = ?", mediaId).Delete(&models.MangaToReadItem{}).Error
	if err != nil {
		db.Logger.Error().Err(err).Int("mediaId", mediaId).Msg("db: Failed to remove manga from to-read list")
		return err
	}
	return nil
}

// IsMangaInToReadList checks if a manga is in the to-read list
func (db *Database) IsMangaInToReadList(mediaId int) (bool, error) {
	var count int64
	err := db.gormdb.Model(&models.MangaToReadItem{}).Where("media_id = ?", mediaId).Count(&count).Error
	if err != nil {
		db.Logger.Error().Err(err).Int("mediaId", mediaId).Msg("db: Failed to check if manga is in to-read list")
		return false, err
	}
	return count > 0, nil
}

// GetMangaToReadMediaIds returns just the media IDs in the to-read list
func (db *Database) GetMangaToReadMediaIds() ([]int, error) {
	var items []*models.MangaToReadItem
	err := db.gormdb.Order("created_at DESC").Find(&items).Error
	if err != nil {
		db.Logger.Error().Err(err).Msg("db: Failed to get manga to-read list")
		return nil, err
	}
	
	ids := make([]int, len(items))
	for i, item := range items {
		ids[i] = item.MediaID
	}
	return ids, nil
}
