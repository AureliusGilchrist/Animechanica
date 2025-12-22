import { MediaDownloadStatus, useGetMediaDownloadingStatus } from "@/api/hooks/torrent_client.hooks"
import { useMemo } from "react"

// Global cache for the status map to avoid rebuilding it for each component
let cachedStatusMap: Map<number, MediaDownloadStatus> | null = null
let cachedDataRef: Array<MediaDownloadStatus> | undefined = undefined

/**
 * Hook to get the download status of a specific media item.
 * Uses the global media downloading status query with O(1) Map lookup.
 */
export function useMediaDownloadStatus(mediaId: number | undefined) {
    const { data: downloadingMedia } = useGetMediaDownloadingStatus(true)

    // Build/update the cached map only when data changes
    const statusMap = useMemo(() => {
        // If data hasn't changed, return cached map
        if (downloadingMedia === cachedDataRef && cachedStatusMap) {
            return cachedStatusMap
        }
        
        // Build new map
        const map = new Map<number, MediaDownloadStatus>()
        if (downloadingMedia) {
            for (const item of downloadingMedia) {
                map.set(item.mediaId, item)
            }
        }
        
        // Update cache
        cachedStatusMap = map
        cachedDataRef = downloadingMedia
        return map
    }, [downloadingMedia])

    // O(1) lookup instead of O(n) find
    const status = mediaId ? statusMap.get(mediaId) || null : null

    return {
        isDownloading: status?.status === "downloading",
        isSeeding: status?.status === "seeding",
        isPaused: status?.status === "paused",
        isActive: !!status,
        status: status?.status || null,
        progress: status?.progress,
    }
}

/**
 * Hook to get all media download statuses as a map for efficient lookup.
 */
export function useAllMediaDownloadStatuses() {
    const { data: downloadingMedia, isLoading } = useGetMediaDownloadingStatus(true)

    const statusMap = useMemo(() => {
        const map = new Map<number, MediaDownloadStatus>()
        if (downloadingMedia) {
            for (const item of downloadingMedia) {
                map.set(item.mediaId, item)
            }
        }
        return map
    }, [downloadingMedia])

    return {
        statusMap,
        isLoading,
        getStatus: (mediaId: number) => statusMap.get(mediaId) || null,
        isActive: (mediaId: number) => statusMap.has(mediaId),
    }
}
