"use client"
import { useAnimeListTorrentProviderExtensions, useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import {
    useGetEnMasseDownloaderStatus,
    useLoadHakunekoFile,
    useResetEnMasseDownloader,
    useStartEnMasseDownloader,
    useStopEnMasseDownloader,
} from "@/api/hooks/en_masse_downloader.hooks"
import {
    useGetAnimeEnMasseDownloaderStatus,
    useLoadAnimeAnilistFile,
    useResetAnimeEnMasseDownloader,
    useStartAnimeEnMasseDownloader,
    useStopAnimeEnMasseDownloader,
} from "@/api/hooks/anime_en_masse_downloader.hooks"
import { CustomLibraryBanner } from "@/app/(main)/(library)/_containers/custom-library-banner"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Select } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import React from "react"
import { BiDownload, BiPlay, BiReset, BiStop } from "react-icons/bi"
import { LuFileJson } from "react-icons/lu"
import { FiFilm, FiBook } from "react-icons/fi"

export const dynamic = "force-static"

export default function Page() {
    const [activeTab, setActiveTab] = React.useState("anime")

    return (
        <>
            <CustomLibraryBanner discrete />
            <PageWrapper className="p-4 sm:p-8 space-y-4">
                <div className="flex justify-between items-center w-full relative">
                    <div>
                        <h2 className="flex items-center gap-2">
                            <BiDownload className="text-2xl" />
                            En Masse Downloader
                        </h2>
                        <p className="text-[--muted]">
                            Bulk download anime or manga from AniList ID files.
                        </p>
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full max-w-md grid-cols-2">
                        <TabsTrigger value="anime" className="flex items-center gap-2">
                            <FiFilm /> Anime
                        </TabsTrigger>
                        <TabsTrigger value="manga" className="flex items-center gap-2">
                            <FiBook /> Manga
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="anime" className="mt-6">
                        <AnimeEnMasseDownloader />
                    </TabsContent>

                    <TabsContent value="manga" className="mt-6">
                        <MangaEnMasseDownloader />
                    </TabsContent>
                </Tabs>
            </PageWrapper>
        </>
    )
}

// ============================================
// Anime En Masse Downloader Component
// ============================================

function AnimeEnMasseDownloader() {
    const { data: status, isLoading: statusLoading } = useGetAnimeEnMasseDownloaderStatus()
    const { data: providers, isLoading: providersLoading } = useAnimeListTorrentProviderExtensions()

    const { mutate: loadFile, isPending: isLoadingFile, data: loadedEntries } = useLoadAnimeAnilistFile()
    const { mutate: startDownloader, isPending: isStarting } = useStartAnimeEnMasseDownloader()
    const { mutate: stopDownloader, isPending: isStopping } = useStopAnimeEnMasseDownloader()
    const { mutate: resetDownloader, isPending: isResetting } = useResetAnimeEnMasseDownloader()

    const [filePath, setFilePath] = React.useState("/aeternae/Configurations/Manga/anilist-minified.json")
    const [selectedProvider, setSelectedProvider] = React.useState("")
    const providerOptions = React.useMemo(() => {
        return providers?.map(p => ({
            label: p.name,
            value: p.id,
        })) ?? []
    }, [providers])

    const isRunning = status?.isRunning ?? false
    const progress = status?.totalAnimeCount
        ? Math.round((status.currentAnimeIndex / status.totalAnimeCount) * 100)
        : 0

    const canResume = status?.canResume ?? false

    const getPhaseLabel = (phase: string) => {
        switch (phase) {
            case "fetching":
                return "Fetching anime from AniList..."
            case "searching":
                return "Searching for torrents..."
            case "downloading":
                return "Adding torrent..."
            case "waiting":
                return "Rate limiting cooldown..."
            case "waiting_offline":
                return "Waiting for connection..."
            default:
                return "Idle"
        }
    }

    if (statusLoading || providersLoading) {
        return <LoadingSpinner />
    }

    return (
        <div className="space-y-6">
            {/* Configuration Card */}
            <Card className="p-4 space-y-4">
                <h3 className="font-semibold text-lg">Anime Configuration</h3>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">AniList ID File Path</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={filePath}
                                onChange={(e) => setFilePath(e.target.value)}
                                className="flex-1 px-3 py-2 rounded-md border bg-[--background] text-sm"
                                placeholder="/path/to/anilist-minified.json"
                                disabled={isRunning}
                            />
                            <Button
                                intent="primary-subtle"
                                leftIcon={<LuFileJson />}
                                onClick={() => loadFile({ filePath })}
                                loading={isLoadingFile}
                                disabled={isRunning || !filePath}
                            >
                                Load File
                            </Button>
                        </div>
                        {loadedEntries && (
                            <p className="text-sm text-green-500">
                                ✓ Loaded {loadedEntries.length} anime IDs
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Torrent Provider</label>
                        <Select
                            value={selectedProvider}
                            onValueChange={setSelectedProvider}
                            options={providerOptions}
                            disabled={isRunning}
                        />
                        <p className="text-xs text-[--muted]">
                            Select the torrent provider to search for anime.
                        </p>
                    </div>

                    <div className="flex gap-2 pt-2 flex-wrap">
                        {!isRunning ? (
                            <>
                                <Button
                                    intent="success"
                                    leftIcon={<BiPlay />}
                                    onClick={() => startDownloader({ filePath, provider: selectedProvider })}
                                    loading={isStarting}
                                    disabled={!filePath || !selectedProvider}
                                >
                                    Start Downloading
                                </Button>
                                {canResume && (
                                    <Button
                                        intent="warning"
                                        leftIcon={<BiPlay />}
                                        onClick={() => startDownloader({ resume: true })}
                                        loading={isStarting}
                                    >
                                        Resume ({status?.currentAnimeIndex}/{status?.totalAnimeCount})
                                    </Button>
                                )}
                            </>
                        ) : (
                            <Button
                                intent="alert"
                                leftIcon={<BiStop />}
                                onClick={() => stopDownloader()}
                                loading={isStopping}
                            >
                                Stop
                            </Button>
                        )}
                        <Button
                            intent="gray-subtle"
                            leftIcon={<BiReset />}
                            onClick={() => resetDownloader()}
                            loading={isResetting}
                            disabled={isRunning}
                        >
                            Reset Status
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Status Card */}
            {(isRunning || (status?.processedAnime?.length ?? 0) > 0 || (status?.failedAnime?.length ?? 0) > 0 || (status?.skippedAnime?.length ?? 0) > 0) && (
                <Card className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Progress</h3>
                        {isRunning && (
                            <Badge intent="warning" size="lg">
                                Running
                            </Badge>
                        )}
                    </div>

                    {isRunning && (
                        <>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span>
                                        Processing: <strong>{status?.currentAnimeTitle}</strong>
                                    </span>
                                    <span>
                                        {status?.currentAnimeIndex} / {status?.totalAnimeCount}
                                    </span>
                                </div>
                                <ProgressBar value={progress} />
                                <p className="text-sm text-[--muted]">
                                    {getPhaseLabel(status?.currentPhase ?? "idle")}
                                </p>
                            </div>
                            <Separator />
                        </>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-green-500">
                                {status?.processedAnime?.length ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Downloaded</p>
                        </div>
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-yellow-500">
                                {status?.skippedAnime?.length ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Skipped</p>
                        </div>
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-red-500">
                                {status?.failedAnime?.length ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Failed</p>
                        </div>
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-blue-500">
                                {status?.downloadedCount ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Total Downloaded</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Processed Anime List */}
            {(status?.processedAnime?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-green-500">
                        Successfully Downloaded ({status?.processedAnime?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.processedAnime?.map((anime, idx) => (
                            <div
                                key={idx}
                                className="flex justify-between items-center p-2 bg-[--background] rounded-md"
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{anime.title}</p>
                                    <p className="text-xs text-[--muted] truncate">{anime.torrentName}</p>
                                </div>
                                <div className="flex gap-2 ml-2">
                                    <Badge intent="success" size="sm">
                                        {anime.seeders} seeders
                                    </Badge>
                                    {anime.resolution && (
                                        <Badge intent="primary" size="sm">
                                            {anime.resolution}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Skipped Anime List */}
            {(status?.skippedAnime?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-yellow-500">
                        Skipped ({status?.skippedAnime?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.skippedAnime?.map((anime, idx) => (
                            <div
                                key={idx}
                                className="p-2 bg-[--background] rounded-md"
                            >
                                <p className="font-medium truncate">{anime.title || `Media ID: ${anime.mediaId}`}</p>
                                <p className="text-sm text-yellow-400">{anime.reason}</p>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Failed Anime List */}
            {(status?.failedAnime?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-red-500">
                        Failed ({status?.failedAnime?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.failedAnime?.map((anime, idx) => (
                            <div
                                key={idx}
                                className="p-2 bg-[--background] rounded-md"
                            >
                                <p className="font-medium truncate">{anime.title || `Media ID: ${anime.mediaId}`}</p>
                                <p className="text-sm text-red-400">{anime.reason}</p>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Index Failed Anime List */}
            {(status?.indexFailedAnime?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-yellow-500">
                        Index Failed ({status?.indexFailedAnime?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.indexFailedAnime?.map((anime, idx) => (
                            <div
                                key={idx}
                                className="p-2 bg-[--background] rounded-md"
                            >
                                <p className="font-medium truncate">Media ID: {anime.mediaId}</p>
                                <p className="text-sm text-yellow-400">{anime.reason}</p>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Info Card */}
            <Alert intent="info" title="How it works">
                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Load an AniList ID file (JSON format with "deadEntries" array)</li>
                    <li>Select a torrent provider and download destination</li>
                    <li>The downloader will fetch each anime from AniList</li>
                    <li>Search for batch/complete series torrents</li>
                    <li>Prefer <strong>Dual Audio</strong> or <strong>Multi Audio</strong> releases</li>
                    <li>Prefer highest resolution (4K &gt; 1080p &gt; 720p)</li>
                    <li>Only download torrents with <strong>&gt;3 seeders</strong></li>
                    <li>Skip anime that already have a torrent associated</li>
                    <li><strong>Offline handling:</strong> Pauses automatically when offline, resumes when back online</li>
                    <li><strong>Resume support:</strong> Progress is saved automatically</li>
                    <li>Rate limiting respects AniList API limits (2-3 seconds between requests)</li>
                </ul>
            </Alert>
        </div>
    )
}

// ============================================
// Manga En Masse Downloader Component
// ============================================

function MangaEnMasseDownloader() {
    const { data: status, isLoading: statusLoading } = useGetEnMasseDownloaderStatus()
    const { data: providers, isLoading: providersLoading } = useListMangaProviderExtensions()

    const { mutate: loadFile, isPending: isLoadingFile, data: loadedEntries } = useLoadHakunekoFile()
    const { mutate: startDownloader, isPending: isStarting } = useStartEnMasseDownloader()
    const { mutate: stopDownloader, isPending: isStopping } = useStopEnMasseDownloader()
    const { mutate: resetDownloader, isPending: isResetting } = useResetEnMasseDownloader()

    const [filePath, setFilePath] = React.useState("/aeternae/Configurations/Manga/hakuneko.mangas.mangadex")
    const [selectedProvider, setSelectedProvider] = React.useState("")

    const providerOptions = React.useMemo(() => {
        return providers?.map(p => ({
            label: p.name,
            value: p.id,
        })) ?? []
    }, [providers])

    const isRunning = status?.isRunning ?? false
    const progress = status?.totalMangaCount
        ? Math.round((status.currentMangaIndex / status.totalMangaCount) * 100)
        : 0

    const canResume = status?.canResume ?? false

    const getPhaseLabel = (phase: string) => {
        switch (phase) {
            case "searching":
                return "Searching on AniList..."
            case "fetching_chapters":
                return "Fetching chapters..."
            case "queueing":
                return "Queueing chapters..."
            case "waiting":
                return "Rate limiting cooldown..."
            case "waiting_queue":
                return "Waiting for queue space (max 50 manga)..."
            default:
                return "Idle"
        }
    }

    if (statusLoading || providersLoading) {
        return <LoadingSpinner />
    }

    return (
        <div className="space-y-6">
            {/* Configuration Card */}
            <Card className="p-4 space-y-4">
                <h3 className="font-semibold text-lg">Manga Configuration</h3>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">HakuneKo Export File Path</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={filePath}
                                onChange={(e) => setFilePath(e.target.value)}
                                className="flex-1 px-3 py-2 rounded-md border bg-[--background] text-sm"
                                placeholder="/path/to/hakuneko.mangas.json"
                                disabled={isRunning}
                            />
                            <Button
                                intent="primary-subtle"
                                leftIcon={<LuFileJson />}
                                onClick={() => loadFile({ filePath })}
                                loading={isLoadingFile}
                                disabled={isRunning || !filePath}
                            >
                                Load File
                            </Button>
                        </div>
                        {loadedEntries && (
                            <p className="text-sm text-green-500">
                                ✓ Loaded {loadedEntries.length} manga entries
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Manga Provider</label>
                        <Select
                            value={selectedProvider}
                            onValueChange={setSelectedProvider}
                            options={providerOptions}
                            disabled={isRunning}
                        />
                        <p className="text-xs text-[--muted]">
                            Select the provider to use for fetching chapters.
                        </p>
                    </div>

                    <div className="flex gap-2 pt-2 flex-wrap">
                        {!isRunning ? (
                            <>
                                <Button
                                    intent="success"
                                    leftIcon={<BiPlay />}
                                    onClick={() => startDownloader({ filePath, provider: selectedProvider })}
                                    loading={isStarting}
                                    disabled={!filePath || !selectedProvider}
                                >
                                    Start Downloading
                                </Button>
                                {canResume && (
                                    <Button
                                        intent="warning"
                                        leftIcon={<BiPlay />}
                                        onClick={() => startDownloader({ resume: true })}
                                        loading={isStarting}
                                    >
                                        Resume ({status?.currentMangaIndex}/{status?.totalMangaCount})
                                    </Button>
                                )}
                            </>
                        ) : (
                            <Button
                                intent="alert"
                                leftIcon={<BiStop />}
                                onClick={() => stopDownloader()}
                                loading={isStopping}
                            >
                                Stop
                            </Button>
                        )}
                        <Button
                            intent="gray-subtle"
                            leftIcon={<BiReset />}
                            onClick={() => resetDownloader()}
                            loading={isResetting}
                            disabled={isRunning}
                        >
                            Reset Status
                        </Button>
                    </div>
                </div>
            </Card>

            {/* Status Card */}
            {(isRunning || (status?.processedManga?.length ?? 0) > 0 || (status?.failedManga?.length ?? 0) > 0) && (
                <Card className="p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg">Progress</h3>
                        {isRunning && (
                            <Badge intent="warning" size="lg">
                                Running
                            </Badge>
                        )}
                    </div>

                    {isRunning && (
                        <>
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm">
                                    <span>
                                        Processing: <strong>{status?.currentMangaTitle}</strong>
                                    </span>
                                    <span>
                                        {status?.currentMangaIndex} / {status?.totalMangaCount}
                                    </span>
                                </div>
                                <ProgressBar value={progress} />
                                <p className="text-sm text-[--muted]">
                                    {getPhaseLabel(status?.currentPhase ?? "idle")}
                                </p>
                            </div>
                            <Separator />
                        </>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-green-500">
                                {status?.processedManga?.length ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Processed</p>
                        </div>
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-red-500">
                                {status?.failedManga?.length ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Failed</p>
                        </div>
                        <div className="text-center p-4 bg-[--background] rounded-lg">
                            <p className="text-3xl font-bold text-blue-500">
                                {status?.queuedChapterCount ?? 0}
                            </p>
                            <p className="text-sm text-[--muted]">Chapters Queued</p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Processed Manga List */}
            {(status?.processedManga?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-green-500">
                        Successfully Processed ({status?.processedManga?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.processedManga?.map((manga, idx) => (
                            <div
                                key={idx}
                                className="flex justify-between items-center p-2 bg-[--background] rounded-md"
                            >
                                <span className="truncate flex-1">{manga.title}</span>
                                <Badge intent="success" size="sm">
                                    {manga.chapterCount} chapters
                                </Badge>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Failed Manga List */}
            {(status?.failedManga?.length ?? 0) > 0 && (
                <Card className="p-4 space-y-4">
                    <h3 className="font-semibold text-lg text-red-500">
                        Failed ({status?.failedManga?.length})
                    </h3>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                        {status?.failedManga?.map((manga, idx) => (
                            <div
                                key={idx}
                                className="p-2 bg-[--background] rounded-md"
                            >
                                <p className="font-medium truncate">{manga.title}</p>
                                <p className="text-sm text-red-400">{manga.reason}</p>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Info Card */}
            <Alert intent="info" title="How it works">
                <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>Load a HakuneKo manga export file (JSON format)</li>
                    <li>Select a manga provider to fetch chapters from</li>
                    <li>The downloader will search each manga on AniList to get the media ID</li>
                    <li>Then fetch all chapters from the selected provider</li>
                    <li>Finally, queue all chapters for download</li>
                    <li>Rate limiting is applied to avoid getting banned</li>
                    <li><strong>Queue limit:</strong> Maximum 50 manga in queue at once - waits for downloads to complete before adding more</li>
                    <li><strong>Resume support:</strong> Progress is saved automatically - if stopped or interrupted, click "Resume" to continue</li>
                    <li>After completion, start the download queue from the manga page</li>
                </ul>
            </Alert>
        </div>
    )
}
