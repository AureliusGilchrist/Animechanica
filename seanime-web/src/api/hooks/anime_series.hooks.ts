import { useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"

export type SeriesEntry = {
    media: any
    downloadInfo?: {
        episodeCount: number
        downloaded: number
        notDownloaded: number
    }
    libraryData?: {
        hasLocalFiles: boolean
        fileCount: number
    }
}

export function useGetAllSeries({ enabled }: { enabled?: boolean } = { enabled: true }) {
    return useServerQuery<Array<SeriesEntry>>({
        endpoint: API_ENDPOINTS.ANIME_COLLECTION.GetAllSeries.endpoint,
        method: API_ENDPOINTS.ANIME_COLLECTION.GetAllSeries.methods[0],
        queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetAllSeries.key],
        enabled: enabled,
    })
}
