import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Types for the anime en masse downloader
export interface ProcessedAnimeInfo {
    title: string
    mediaId: number
    torrentName: string
    seeders: number
    resolution: string
}

export interface FailedAnimeInfo {
    title: string
    mediaId: number
    reason: string
}

export interface SkippedAnimeInfo {
    title: string
    mediaId: number
    reason: string
}

export interface AnimeEnMasseDownloaderStatus {
    isRunning: boolean
    currentAnimeIndex: number
    totalAnimeCount: number
    currentAnimeTitle: string
    currentPhase: string
    processedAnime: ProcessedAnimeInfo[]
    failedAnime: FailedAnimeInfo[]
    skippedAnime: SkippedAnimeInfo[]
    downloadedCount: number
    filePath: string
    provider: string
    canResume: boolean
}

const ANIME_EN_MASSE_ENDPOINTS = {
    GetStatus: {
        endpoint: "/api/v1/anime-en-masse/status",
        methods: ["GET"] as const,
        key: "anime-en-masse-status",
    },
    LoadFile: {
        endpoint: "/api/v1/anime-en-masse/load-file",
        methods: ["POST"] as const,
        key: "anime-en-masse-load-file",
    },
    Start: {
        endpoint: "/api/v1/anime-en-masse/start",
        methods: ["POST"] as const,
        key: "anime-en-masse-start",
    },
    Stop: {
        endpoint: "/api/v1/anime-en-masse/stop",
        methods: ["POST"] as const,
        key: "anime-en-masse-stop",
    },
    Reset: {
        endpoint: "/api/v1/anime-en-masse/reset",
        methods: ["POST"] as const,
        key: "anime-en-masse-reset",
    },
}

export function useGetAnimeEnMasseDownloaderStatus() {
    return useServerQuery<AnimeEnMasseDownloaderStatus>({
        endpoint: ANIME_EN_MASSE_ENDPOINTS.GetStatus.endpoint,
        method: ANIME_EN_MASSE_ENDPOINTS.GetStatus.methods[0],
        queryKey: [ANIME_EN_MASSE_ENDPOINTS.GetStatus.key],
        enabled: true,
        refetchInterval: 2000, // Poll every 2 seconds when running
    })
}

export function useLoadAnimeAnilistFile() {
    return useServerMutation<number[], { filePath: string }>({
        endpoint: ANIME_EN_MASSE_ENDPOINTS.LoadFile.endpoint,
        method: ANIME_EN_MASSE_ENDPOINTS.LoadFile.methods[0],
        mutationKey: [ANIME_EN_MASSE_ENDPOINTS.LoadFile.key],
        onSuccess: () => {
            toast.success("File loaded successfully")
        },
    })
}

export function useStartAnimeEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, { filePath?: string, provider?: string, destination?: string, resume?: boolean }>({
        endpoint: ANIME_EN_MASSE_ENDPOINTS.Start.endpoint,
        method: ANIME_EN_MASSE_ENDPOINTS.Start.methods[0],
        mutationKey: [ANIME_EN_MASSE_ENDPOINTS.Start.key],
        onSuccess: async (_, variables) => {
            toast.success(variables.resume ? "Anime En Masse Downloader resumed" : "Anime En Masse Downloader started")
            await queryClient.invalidateQueries({ queryKey: [ANIME_EN_MASSE_ENDPOINTS.GetStatus.key] })
        },
    })
}

export function useStopAnimeEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean>({
        endpoint: ANIME_EN_MASSE_ENDPOINTS.Stop.endpoint,
        method: ANIME_EN_MASSE_ENDPOINTS.Stop.methods[0],
        mutationKey: [ANIME_EN_MASSE_ENDPOINTS.Stop.key],
        onSuccess: async () => {
            toast.info("Anime En Masse Downloader stopped")
            await queryClient.invalidateQueries({ queryKey: [ANIME_EN_MASSE_ENDPOINTS.GetStatus.key] })
        },
    })
}

export function useResetAnimeEnMasseDownloader() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean>({
        endpoint: ANIME_EN_MASSE_ENDPOINTS.Reset.endpoint,
        method: ANIME_EN_MASSE_ENDPOINTS.Reset.methods[0],
        mutationKey: [ANIME_EN_MASSE_ENDPOINTS.Reset.key],
        onSuccess: async () => {
            toast.success("Anime En Masse Downloader reset")
            await queryClient.invalidateQueries({ queryKey: [ANIME_EN_MASSE_ENDPOINTS.GetStatus.key] })
        },
    })
}
