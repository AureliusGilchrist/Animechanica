package anilist

import (
	"context"

	"golang.org/x/sync/semaphore"
)

var (
	aniListGlobalSemaphore = semaphore.NewWeighted(1)
)

func acquireAniListSlot(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	return aniListGlobalSemaphore.Acquire(ctx, 1)
}

func releaseAniListSlot() {
	aniListGlobalSemaphore.Release(1)
}
