"use client"
import { Manga_Collection } from "@/api/generated/types"
import { useGetMangaToReadList } from "@/api/hooks/manga_to_read.hooks"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { __mangaLibraryHeaderImageAtom } from "@/app/(main)/manga/_components/library-header"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { cn } from "@/components/ui/core/styling"
import { useSetAtom } from "jotai/index"
import React from "react"

type MangaToReadListProps = {
    collection: Manga_Collection | undefined
    type?: "carousel" | "grid"
}

export function MangaToReadList(props: MangaToReadListProps) {
    const { collection, type = "grid" } = props

    const { data: toReadIds, isLoading } = useGetMangaToReadList()
    const setCurrentHeaderImage = useSetAtom(__mangaLibraryHeaderImageAtom)

    // Get the manga entries from the collection that are in the to-read list
    const toReadEntries = React.useMemo(() => {
        if (!toReadIds || !collection?.lists) return []

        const allEntries = collection.lists.flatMap(list => list.entries || [])
        
        // Filter entries that are in the to-read list and maintain the order from toReadIds
        return toReadIds
            .map(id => allEntries.find(entry => entry.mediaId === id))
            .filter(Boolean)
    }, [toReadIds, collection])

    if (isLoading || !toReadEntries.length) return null

    return (
        <div className="space-y-4" data-manga-to-read-list-container>
            <div className="flex gap-3 items-center" data-manga-to-read-list-header>
                <h2>Reading List</h2>
            </div>

            {type === "grid" && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
                    {toReadEntries.map(entry => (
                        <div
                            key={entry!.media?.id}
                            onMouseEnter={() => {
                                if (entry!.media?.bannerImage) {
                                    React.startTransition(() => {
                                        setCurrentHeaderImage(entry!.media?.bannerImage!)
                                    })
                                }
                            }}
                        >
                            <MediaEntryCard
                                media={entry!.media!}
                                listData={entry!.listData}
                                showListDataButton
                                withAudienceScore={false}
                                type="manga"
                            />
                        </div>
                    ))}
                </div>
            )}

            {type === "carousel" && (
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
                        {toReadEntries.map(entry => (
                            <div
                                key={entry!.media?.id}
                                className="relative basis-[200px] col-span-1 place-content-stretch flex-none md:basis-[250px] mx-2 mt-8 mb-0"
                                onMouseEnter={() => {
                                    if (entry!.media?.bannerImage) {
                                        React.startTransition(() => {
                                            setCurrentHeaderImage(entry!.media?.bannerImage!)
                                        })
                                    }
                                }}
                            >
                                <MediaEntryCard
                                    media={entry!.media!}
                                    listData={entry!.listData}
                                    showListDataButton
                                    withAudienceScore={false}
                                    type="manga"
                                />
                            </div>
                        ))}
                    </CarouselContent>
                </Carousel>
            )}
        </div>
    )
}
