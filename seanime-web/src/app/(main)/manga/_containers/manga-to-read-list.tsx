"use client"
import { Manga_Collection } from "@/api/generated/types"
import { useGetMangaToReadList } from "@/api/hooks/manga_to_read.hooks"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { __mangaLibraryHeaderImageAtom } from "@/app/(main)/manga/_components/library-header"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { cn } from "@/components/ui/core/styling"
import { TextInput } from "@/components/ui/text-input"
import { useSetAtom } from "jotai/index"
import React from "react"
import { BiSearch, BiX } from "react-icons/bi"

type MangaToReadListProps = {
    collection: Manga_Collection | undefined
    type?: "carousel" | "grid"
}

/**
 * Normalize a string for fuzzy search - removes accents, special chars, and lowercases
 */
function normalizeForSearch(str: string | undefined | null): string {
    if (!str) return ""
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^\w\s\u3000-\u9fff\u4e00-\u9faf]/g, "") // Keep alphanumeric, spaces, and CJK characters
        .trim()
}

/**
 * Check if a search query matches a title (fuzzy match)
 * Supports partial matching and word-based matching
 */
function fuzzyMatch(query: string, text: string): boolean {
    if (!query || !text) return false
    const normalizedQuery = normalizeForSearch(query)
    const normalizedText = normalizeForSearch(text)
    
    // Direct substring match
    if (normalizedText.includes(normalizedQuery)) return true
    
    // Word-based match - all query words must be present
    const queryWords = normalizedQuery.split(/\s+/).filter(Boolean)
    if (queryWords.length > 1) {
        return queryWords.every(word => normalizedText.includes(word))
    }
    
    return false
}

export function MangaToReadList(props: MangaToReadListProps) {
    const { collection, type = "grid" } = props

    const { data: toReadIds, isLoading } = useGetMangaToReadList()
    const setCurrentHeaderImage = useSetAtom(__mangaLibraryHeaderImageAtom)
    const [searchQuery, setSearchQuery] = React.useState("")

    // Get the manga entries from the collection that are in the to-read list
    const toReadEntries = React.useMemo(() => {
        if (!toReadIds || !collection?.lists) return []

        const allEntries = collection.lists.flatMap(list => list.entries || [])
        
        // Filter entries that are in the to-read list and maintain the order from toReadIds
        return toReadIds
            .map(id => allEntries.find(entry => entry.mediaId === id))
            .filter(Boolean)
    }, [toReadIds, collection])

    // Filter entries based on search query (searches romaji, english, and native titles)
    const filteredEntries = React.useMemo(() => {
        if (!searchQuery.trim()) return toReadEntries
        
        return toReadEntries.filter(entry => {
            const media = entry?.media
            if (!media) return false
            
            // Search across all title variants
            const titles = [
                media.title?.romaji,
                media.title?.english,
                media.title?.native,
                // Also search synonyms if available
                ...(media.synonyms || []),
            ]
            
            return titles.some(title => fuzzyMatch(searchQuery, title || ""))
        })
    }, [toReadEntries, searchQuery])

    if (isLoading || !toReadEntries.length) return null

    return (
        <div className="space-y-4" data-manga-to-read-list-container>
            <div className="flex flex-wrap gap-3 items-center justify-between" data-manga-to-read-list-header>
                <h2>Reading List</h2>
                <div className="relative w-full sm:w-auto sm:min-w-[250px] md:min-w-[300px]">
                    <TextInput
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search by title (romaji, english, japanese)..."
                        leftIcon={<BiSearch className="text-[--muted]" />}
                        rightIcon={searchQuery ? (
                            <BiX 
                                className="text-[--muted] cursor-pointer hover:text-[--foreground] transition-colors" 
                                onClick={() => setSearchQuery("")}
                            />
                        ) : undefined}
                        className="w-full"
                    />
                </div>
            </div>
            
            {filteredEntries.length === 0 && searchQuery && (
                <p className="text-[--muted] text-center py-4">No manga found matching "{searchQuery}"</p>
            )}

            {type === "grid" && filteredEntries.length > 0 && (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
                    {filteredEntries.map(entry => (
                        <div
                            key={entry!.media?.id}
                            className="scale-[0.98] origin-top-left"
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

            {type === "carousel" && filteredEntries.length > 0 && (
                <Carousel
                    className={cn("w-full max-w-full !mt-0")}
                    gap="md"
                    opts={{
                        align: "start",
                        dragFree: true,
                    }}
                    autoScroll={false}
                >
                    <CarouselDotButtons className="-top-2" />
                    <CarouselContent className="px-6">
                        {filteredEntries.map(entry => (
                            <div
                                key={entry!.media?.id}
                                className="relative basis-[140px] col-span-1 place-content-stretch flex-none md:basis-[175px] mx-1 mt-6 mb-0"
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
