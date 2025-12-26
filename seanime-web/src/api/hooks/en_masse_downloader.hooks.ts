import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { EnMasseDownloaderStatus, HakunekoMangaEntry } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export function useGetEnMasseDownloaderStatus() {
    return useServerQuery<EnMasseDownloaderStatus>({
        endpoint: API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.endpoint,
        method: API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.methods[0],
        queryKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.key],
        enabled: true,
        refetchInterval: 2000, // Poll every 2 seconds when running
    })
}

export function useLoadHakunekoFile() {
    return useServerMutation<Array<HakunekoMangaEntry>, { filePath: string }>({
        endpoint: API_ENDPOINTS.EN_MASSE_DOWNLOADER.LoadHakunekoFile.endpoint,
        method: API_ENDPOINTS.EN_MASSE_DOWNLOADER.LoadHakunekoFile.methods[0],
        mutationKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.LoadHakunekoFile.key],
        onSuccess: () => {
            toast.success("File loaded successfully")
        },
    })
}

export function useStartEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, { filePath?: string, provider?: string, resume?: boolean }>({
        endpoint: API_ENDPOINTS.EN_MASSE_DOWNLOADER.StartEnMasseDownloader.endpoint,
        method: API_ENDPOINTS.EN_MASSE_DOWNLOADER.StartEnMasseDownloader.methods[0],
        mutationKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.StartEnMasseDownloader.key],
        onSuccess: async (_, variables) => {
            toast.success(variables.resume ? "En Masse Downloader resumed" : "En Masse Downloader started")
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.key] })
        },
    })
}

export function useStopEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.EN_MASSE_DOWNLOADER.StopEnMasseDownloader.endpoint,
        method: API_ENDPOINTS.EN_MASSE_DOWNLOADER.StopEnMasseDownloader.methods[0],
        mutationKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.StopEnMasseDownloader.key],
        onSuccess: async () => {
            toast.info("En Masse Downloader stopped")
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.key] })
        },
    })
}

export function useResetEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.EN_MASSE_DOWNLOADER.ResetEnMasseDownloader.endpoint,
        method: API_ENDPOINTS.EN_MASSE_DOWNLOADER.ResetEnMasseDownloader.methods[0],
        mutationKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.ResetEnMasseDownloader.key],
        onSuccess: async () => {
            toast.success("En Masse Downloader reset")
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.EN_MASSE_DOWNLOADER.GetEnMasseDownloaderStatus.key] })
        },
    })
}
