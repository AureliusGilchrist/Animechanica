package db

import (
	"seanime/internal/database/models"
	"strings"
)

// SaveTorrentMediaAssociation saves an association between a torrent info hash and a media ID.
// If an association already exists for the info hash, it will be updated.
func (db *Database) SaveTorrentMediaAssociation(infoHash string, mediaId int) error {
	infoHash = strings.ToLower(infoHash)

	var existing models.TorrentMediaAssociation
	err := db.gormdb.Where("info_hash = ?", infoHash).First(&existing).Error
	if err == nil {
		// Update existing
		existing.MediaId = mediaId
		return db.gormdb.Save(&existing).Error
	}

	// Create new
	item := &models.TorrentMediaAssociation{
		InfoHash: infoHash,
		MediaId:  mediaId,
	}
	return db.gormdb.Create(item).Error
}

// GetTorrentMediaAssociationByHash retrieves a media ID by torrent info hash.
func (db *Database) GetTorrentMediaAssociationByHash(infoHash string) (int, bool) {
	infoHash = strings.ToLower(infoHash)

	var res models.TorrentMediaAssociation
	err := db.gormdb.Where("info_hash = ?", infoHash).First(&res).Error
	if err != nil {
		return 0, false
	}
	return res.MediaId, true
}

// GetAllTorrentMediaAssociations retrieves all torrent-media associations.
func (db *Database) GetAllTorrentMediaAssociations() ([]*models.TorrentMediaAssociation, error) {
	var res []*models.TorrentMediaAssociation
	err := db.gormdb.Find(&res).Error
	if err != nil {
		return nil, err
	}
	return res, nil
}

// DeleteTorrentMediaAssociation deletes an association by info hash.
func (db *Database) DeleteTorrentMediaAssociation(infoHash string) error {
	infoHash = strings.ToLower(infoHash)
	return db.gormdb.Where("info_hash = ?", infoHash).Delete(&models.TorrentMediaAssociation{}).Error
}

// ClearAllTorrentMediaAssociations removes all torrent-media associations from the database.
func (db *Database) ClearAllTorrentMediaAssociations() error {
	return db.gormdb.Where("1 = 1").Delete(&models.TorrentMediaAssociation{}).Error
}

// CleanupOldTorrentMediaAssociations removes associations older than the specified number of days.
func (db *Database) CleanupOldTorrentMediaAssociations(days int) error {
	return db.gormdb.Where("created_at < datetime('now', ?)", "-"+string(rune(days))+" days").Delete(&models.TorrentMediaAssociation{}).Error
}
