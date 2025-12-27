package anilist

import (
	"context"
	"sync"
	"time"

	"golang.org/x/sync/semaphore"
)

var (
	aniListGlobalSemaphore = semaphore.NewWeighted(1)
	aniListRateMu          sync.Mutex
	lastAniListRequest     time.Time
	aniListMinInterval     = 1500 * time.Millisecond
)

func acquireAniListSlot(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}

	if err := aniListGlobalSemaphore.Acquire(ctx, 1); err != nil {
		return err
	}

	for {
		aniListRateMu.Lock()
		waitDuration := aniListMinInterval - time.Since(lastAniListRequest)
		if waitDuration <= 0 {
			lastAniListRequest = time.Now()
			aniListRateMu.Unlock()
			return nil
		}
		aniListRateMu.Unlock()

		select {
		case <-ctx.Done():
			aniListGlobalSemaphore.Release(1)
			return ctx.Err()
		case <-time.After(waitDuration):
		}
	}
}

func releaseAniListSlot() {
	aniListGlobalSemaphore.Release(1)
}
