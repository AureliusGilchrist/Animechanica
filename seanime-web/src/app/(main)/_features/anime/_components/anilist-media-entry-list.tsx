import { AL_AnimeCollection_MediaListCollection_Lists, AL_AnimeCollection_MediaListCollection_Lists_Entries, Anime_EntryLibraryData } from "@/api/generated/types"
import { useLibraryCollection } from "@/app/(main)/_hooks/anime-library-collection-loader"
import { MediaCardLazyGrid } from "@/app/(main)/_features/media/_components/media-card-grid"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { cn } from "@/components/ui/core/styling"
import React, { useMemo } from "react"


type AnilistAnimeEntryListProps = {
    list: AL_AnimeCollection_MediaListCollection_Lists | undefined
    type: "anime" | "manga"
    layout?: "grid" | "carousel"
}

/**
 * Displays a list of media entry card from an Anilist media list collection.
 * Shows library badge for entries that are in the local library and download status badges.
 */
export function AnilistAnimeEntryList(props: AnilistAnimeEntryListProps) {

    const {
        list,
        type,
        layout = "grid",
        ...rest
    } = props

    // Get the library collection to check if entries are in the local library
    const libraryCollection = useLibraryCollection()

    // Create a map of mediaId -> libraryData for quick lookup
    const libraryDataMap = useMemo(() => {
        const map = new Map<number, Anime_EntryLibraryData>()
        if (libraryCollection?.lists) {
            for (const libraryList of libraryCollection.lists) {
                for (const entry of (libraryList.entries ?? [])) {
                    if (entry.libraryData && entry.mediaId) {
                        map.set(entry.mediaId, entry.libraryData)
                    }
                }
            }
        }
        // Debug: log the map size to verify data is being loaded
        if (map.size > 0) {
            console.log(`[AnilistAnimeEntryList] Library data map has ${map.size} entries`)
        }
        return map
    }, [libraryCollection])

    function getListData(entry: AL_AnimeCollection_MediaListCollection_Lists_Entries) {
        return {
            progress: entry.progress!,
            score: entry.score!,
            status: entry.status!,
            startedAt: entry.startedAt?.year ? new Date(entry.startedAt.year,
                (entry.startedAt.month || 1) - 1,
                entry.startedAt.day || 1).toISOString() : undefined,
            completedAt: entry.completedAt?.year ? new Date(entry.completedAt.year,
                (entry.completedAt.month || 1) - 1,
                entry.completedAt.day || 1).toISOString() : undefined,
        }
    }

    if (layout === "carousel") return (
        <Carousel
            className={cn("w-full max-w-full !mt-0")}
            gap="xl"
            opts={{
                align: "start",
                dragFree: true,
            }}
            autoScroll={false}
        >
            <CarouselDotButtons className="-top-2" />
            <CarouselContent className="px-6">
                {list?.entries?.filter(Boolean)?.map(entry => {
                    const libraryData = type === "anime" && entry.media?.id ? libraryDataMap.get(entry.media.id) : undefined
                    return <div
                        key={entry.media?.id}
                        className={"relative basis-[200px] col-span-1 place-content-stretch flex-none md:basis-[250px] mx-2 mt-8 mb-0"}
                    >
                        <MediaEntryCard
                            key={`${entry.media?.id}`}
                            listData={getListData(entry)}
                            libraryData={libraryData}
                            showLibraryBadge
                            media={entry.media!}
                            showListDataButton
                            type={type}
                        />
                    </div>
                })}
            </CarouselContent>
        </Carousel>
    )

    return (
        <MediaCardLazyGrid itemCount={list?.entries?.filter(Boolean)?.length || 0} data-anilist-anime-entry-list>
            {list?.entries?.filter(Boolean)?.map((entry) => {
                const libraryData = type === "anime" && entry.media?.id ? libraryDataMap.get(entry.media.id) : undefined
                return (
                    <MediaEntryCard
                        key={`${entry.media?.id}`}
                        listData={getListData(entry)}
                        libraryData={libraryData}
                        showLibraryBadge
                        media={entry.media!}
                        showListDataButton
                        type={type}
                    />
                )
            })}
        </MediaCardLazyGrid>
    )
}
