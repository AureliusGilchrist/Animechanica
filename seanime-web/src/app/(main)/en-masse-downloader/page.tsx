"use client"
import { useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import {
    useGetEnMasseDownloaderStatus,
    useLoadHakunekoFile,
    useResetEnMasseDownloader,
    useStartEnMasseDownloader,
    useStopEnMasseDownloader,
} from "@/api/hooks/en_masse_downloader.hooks"
import { CustomLibraryBanner } from "@/app/(main)/(library)/_containers/custom-library-banner"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/components/ui/core/styling"
import { DataGrid } from "@/components/ui/datagrid"
import { defineSchema, Field, Form } from "@/components/ui/form"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Select } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import React from "react"
import { BiDownload, BiPlay, BiReset, BiStop } from "react-icons/bi"
import { LuFileJson } from "react-icons/lu"

export const dynamic = "force-static"

const formSchema = defineSchema(({ z }) => z.object({
    filePath: z.string().min(1, "File path is required"),
    provider: z.string().min(1, "Provider is required"),
}))

export default function Page() {
    const { data: status, isLoading: statusLoading } = useGetEnMasseDownloaderStatus()
    const { data: providers, isLoading: providersLoading } = useListMangaProviderExtensions()

    const { mutate: loadFile, isPending: isLoadingFile, data: loadedEntries } = useLoadHakunekoFile()
    const { mutate: startDownloader, isPending: isStarting } = useStartEnMasseDownloader()
    const { mutate: stopDownloader, isPending: isStopping } = useStopEnMasseDownloader()
    const { mutate: resetDownloader, isPending: isResetting } = useResetEnMasseDownloader()

    const [filePath, setFilePath] = React.useState("/aeternae/Configurations/Manga/hakuneko.mangas.mangapill")
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
                            Bulk download manga from a HakuneKo export file.
                        </p>
                    </div>
                </div>

                {statusLoading || providersLoading ? (
                    <LoadingSpinner />
                ) : (
                    <div className="space-y-6">
                        {/* Configuration Card */}
                        <Card className="p-4 space-y-4">
                            <h3 className="font-semibold text-lg">Configuration</h3>

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
                )}
            </PageWrapper>
        </>
    )
}
