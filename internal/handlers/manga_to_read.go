package handlers

import (
	"seanime/internal/api/anilist"

	"github.com/labstack/echo/v4"
	"github.com/samber/lo"
)

// HandleGetMangaToReadList
//
//	@summary returns the list of manga IDs in the to-read list.
//	@route /api/v1/manga/to-read [GET]
//	@returns []int
func (h *Handler) HandleGetMangaToReadList(c echo.Context) error {
	ids, err := h.App.Database.GetMangaToReadMediaIds()
	if err != nil {
		return h.RespondWithError(c, err)
	}
	return h.RespondWithData(c, ids)
}

// HandleAddMangaToReadItem
//
//	@summary adds a manga to the to-read list.
//	@desc If the manga is not in the user's AniList collection, it will be added with "Planning" status.
//	@route /api/v1/manga/to-read [POST]
//	@returns bool
func (h *Handler) HandleAddMangaToReadItem(c echo.Context) error {
	type body struct {
		MediaId int `json:"mediaId"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	// Check if the manga is in the user's AniList collection
	mangaCollection, err := h.App.GetMangaCollection(false)
	if err == nil && mangaCollection != nil {
		_, found := mangaCollection.GetListEntryFromMangaId(b.MediaId)
		if !found {
			// Manga is not in the collection, add it to AniList with "Planning" status
			zero := 0
			_, _ = h.App.AnilistClientRef.Get().UpdateMediaListEntryProgress(
				c.Request().Context(),
				&b.MediaId,
				&zero, // progress
				lo.ToPtr(anilist.MediaListStatusPlanning),
			)
		}
	}

	err = h.App.Database.AddMangaToReadItem(b.MediaId)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, true)
}

// HandleRemoveMangaToReadItem
//
//	@summary removes a manga from the to-read list.
//	@route /api/v1/manga/to-read [DELETE]
//	@returns bool
func (h *Handler) HandleRemoveMangaToReadItem(c echo.Context) error {
	type body struct {
		MediaId int `json:"mediaId"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	err := h.App.Database.RemoveMangaToReadItem(b.MediaId)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, true)
}

// HandleIsMangaInToReadList
//
//	@summary checks if a manga is in the to-read list.
//	@route /api/v1/manga/to-read/check [POST]
//	@returns bool
func (h *Handler) HandleIsMangaInToReadList(c echo.Context) error {
	type body struct {
		MediaId int `json:"mediaId"`
	}

	var b body
	if err := c.Bind(&b); err != nil {
		return h.RespondWithError(c, err)
	}

	isInList, err := h.App.Database.IsMangaInToReadList(b.MediaId)
	if err != nil {
		return h.RespondWithError(c, err)
	}

	return h.RespondWithData(c, isInList)
}
