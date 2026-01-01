"use client"
import { useGetAllSeries } from "@/api/hooks/anime_series.hooks"
import { CustomLibraryBanner } from "@/app/(main)/(library)/_containers/custom-library-banner"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Separator } from "@/components/ui/separator"
import { TextInput } from "@/components/ui/text-input"
import { useDebounce } from "@/hooks/use-debounce"
import { imageShimmer } from "@/components/shared/image-helpers"
import Image from "next/image"
import Link from "next/link"
import React from "react"
import { BiCollection } from "react-icons/bi"

export const dynamic = "force-static"

type SeriesEntry = {
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

export default function Page() {
    const { data: seriesData, isLoading } = useGetAllSeries()
    const [searchTerm, setSearchTerm] = React.useState("")
    const debouncedSearchTerm = useDebounce(searchTerm, 300)

    const filteredSeries = React.useMemo(() => {
        if (!seriesData) return []
        if (!debouncedSearchTerm) return seriesData

        const term = debouncedSearchTerm.toLowerCase()
        return seriesData.filter((entry: SeriesEntry) => {
            const title = entry.media.title?.userPreferred?.toLowerCase() || ""
            const romaji = entry.media.title?.romaji?.toLowerCase() || ""
            const english = entry.media.title?.english?.toLowerCase() || ""
            return title.includes(term) || romaji.includes(term) || english.includes(term)
        })
    }, [seriesData, debouncedSearchTerm])

    return (
        <>
            <CustomLibraryBanner discrete />
            <PageWrapper className="p-4 sm:p-8 space-y-4">
                <div className="flex flex-col md:flex-row md:justify-between md:items-center w-full gap-4">
                    <div>
                        <h2 className="flex items-center gap-2">
                            <BiCollection className="text-2xl" />
                            All Series
                        </h2>
                        <p className="text-[--muted]">
                            First entry of every anime franchise in your collection.
                        </p>
                    </div>
                    <div className="w-full md:w-80">
                        <TextInput
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            placeholder="Search series..."
                        />
                    </div>
                </div>

                <Separator />

                {isLoading && (
                    <div className="flex justify-center items-center py-20">
                        <LoadingSpinner />
                    </div>
                )}

                {!isLoading && filteredSeries && (
                    <div className="space-y-2">
                        <p className="text-sm text-[--muted]">
                            Showing {filteredSeries.length} {filteredSeries.length === 1 ? "series" : "series"}
                        </p>
                        <AppLayoutStack spacing="md">
                            {filteredSeries.map((entry: SeriesEntry) => (
                                <SeriesCard key={entry.media.id} entry={entry} />
                            ))}
                        </AppLayoutStack>
                    </div>
                )}
            </PageWrapper>
        </>
    )
}

function SeriesCard({ entry }: { entry: SeriesEntry }) {
    const media = entry.media
    const downloadInfo = entry.downloadInfo
    const libraryData = entry.libraryData

    const hasFiles = libraryData?.hasLocalFiles ?? false
    const fileCount = libraryData?.fileCount ?? 0

    return (
        <Link href={`/entry?id=${media.id}`}>
            <div
                className={cn(
                    "flex gap-4 p-4 rounded-lg border transition-colors hover:bg-[--subtle] cursor-pointer",
                    "border-[--border]",
                )}
            >
                <div className="flex-shrink-0">
                    <div className="w-20 h-28 relative rounded-md overflow-hidden">
                        <Image
                            src={media.coverImage?.large || media.coverImage?.medium || ""}
                            alt={media.title?.userPreferred || ""}
                            fill
                            className="object-cover"
                            placeholder={imageShimmer(700, 475)}
                        />
                    </div>
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                    <div>
                        <h3 className="font-semibold line-clamp-1 text-lg">
                            {media.title?.userPreferred}
                        </h3>
                        {media.startDate?.year && (
                            <p className="text-sm text-[--muted]">
                                {media.startDate.year}
                                {media.format && ` • ${media.format}`}
                                {media.episodes && ` • ${media.episodes} episodes`}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {hasFiles && (
                            <Badge intent="primary-solid" size="sm">
                                {fileCount} {fileCount === 1 ? "file" : "files"}
                            </Badge>
                        )}

                        {downloadInfo && downloadInfo.episodeCount > 0 && (
                            <>
                                {downloadInfo.downloaded > 0 && (
                                    <Badge intent="success-solid" size="sm">
                                        {downloadInfo.downloaded} downloaded
                                    </Badge>
                                )}
                                {downloadInfo.notDownloaded > 0 && (
                                    <Badge intent="gray-solid" size="sm">
                                        {downloadInfo.notDownloaded} not downloaded
                                    </Badge>
                                )}
                            </>
                        )}

                        {media.status && (
                            <Badge
                                intent={
                                    media.status === "FINISHED" ? "success" :
                                        media.status === "RELEASING" ? "primary" :
                                            "gray"
                                }
                                size="sm"
                            >
                                {media.status}
                            </Badge>
                        )}
                    </div>

                    {media.description && (
                        <p
                            className="text-sm text-[--muted] line-clamp-2"
                            dangerouslySetInnerHTML={{
                                __html: media.description.replace(/<br\s*\/?>/gi, " "),
                            }}
                        />
                    )}
                </div>
            </div>
        </Link>
    )
}
