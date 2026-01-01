"use client"
import { Manga_Collection, Manga_DownloadListItem } from "@/api/generated/types"
import { useGetMangaToReadList } from "@/api/hooks/manga_to_read.hooks"
import { MediaEntryCard } from "@/app/(main)/_features/media/_components/media-entry-card"
import { __mangaLibraryHeaderImageAtom } from "@/app/(main)/manga/_components/library-header"
import { useGetMangaDownloadsList } from "@/api/hooks/manga_download.hooks"
import { Carousel, CarouselContent, CarouselDotButtons } from "@/components/ui/carousel"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
    const { data: downloadsList, isLoading: downloadsLoading } = useGetMangaDownloadsList()
    const setCurrentHeaderImage = useSetAtom(__mangaLibraryHeaderImageAtom)
    const [searchQuery, setSearchQuery] = React.useState("")
    const [activeTab, setActiveTab] = React.useState<"reading" | "downloaded">("reading")

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

    const downloadedEntries = React.useMemo(() => downloadsList ?? [], [downloadsList])
    const orphanDownloads = React.useMemo(() => downloadedEntries.filter(item => !item.media), [downloadedEntries])
    const libraryDownloads = React.useMemo(() => downloadedEntries.filter(item => !!item.media), [downloadedEntries])

    const getChapterCount = React.useCallback((item: Manga_DownloadListItem) => {
        return Object.values(item.downloadData ?? {}).reduce((total, chapters) => total + chapters.length, 0)
    }, [])

    return (
        <div className="space-y-4" data-manga-to-read-list-container>
            <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "reading" | "downloaded")} className="w-full">
                <TabsList className="grid w-full max-w-xl grid-cols-2">
                    <TabsTrigger value="reading">
                        Reading List
                    </TabsTrigger>
                    <TabsTrigger value="downloaded">
                        Downloaded
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="reading" className="space-y-4">
                    <div className="flex flex-wrap gap-3 items-center justify-between" data-manga-to-read-list-header>
                        <div>
                            <h2 className="text-lg font-semibold">Reading List</h2>
                            <p className="text-sm text-[--muted]">Items you manually pinned for quick access.</p>
                        </div>
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
                    
                    {isLoading ? (
                        <div className="flex justify-center py-6">
                            <LoadingSpinner />
                        </div>
                    ) : (
                        <>
                            {filteredEntries.length === 0 ? (
                                <p className="text-center text-[--muted] italic py-6">
                                    {searchQuery ? `No manga found matching "${searchQuery}"` : "Your reading list is currently empty."}
                                </p>
                            ) : (
                                <>
                                    {type === "grid" && (
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

                                    {type === "carousel" && (
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
                                </>
                            )}
                        </>
                    )}
                </TabsContent>

                <TabsContent value="downloaded" className="space-y-4">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-lg font-semibold">Downloaded Library</h2>
                        <p className="text-sm text-[--muted]">Everything saved locally, even if it isn’t on your AniList.</p>
                    </div>

                    {downloadsLoading ? (
                        <div className="flex justify-center py-6">
                            <LoadingSpinner />
                        </div>
                    ) : (
                        <>
                            {(!downloadedEntries.length) && (
                                <p className="text-center text-[--muted] italic py-6">
                                    No downloaded chapters detected yet.
                                </p>
                            )}

                            {!!orphanDownloads.length && (
                                <div className="space-y-2">
                                    <p className="text-sm font-semibold text-[--muted] uppercase tracking-wide">Not in AniList</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {orphanDownloads
                                            .sort((a, b) => getChapterCount(b) - getChapterCount(a))
                                            .map(item => (
                                                <div key={`orphan-${item.mediaId}`} className="p-3 rounded-lg border border-dashed border-[--border] bg-[--background]">
                                                    <p className="font-semibold">Media ID {item.mediaId}</p>
                                                    <p className="text-sm text-[--muted]">
                                                        {getChapterCount(item)} chapter{getChapterCount(item) === 1 ? "" : "s"} downloaded
                                                    </p>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}

                            {!!libraryDownloads.length && (
                                <div
                                    data-downloaded-media-grid
                                    className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3"
                                >
                                    {libraryDownloads
                                        .sort((a, b) => getChapterCount(b) - getChapterCount(a))
                                        .map(item => {
                                            const nb = getChapterCount(item)
                                            return (
                                                <div key={`dl-${item.mediaId}`}>
                                                    <MediaEntryCard
                                                        media={item.media!}
                                                        type="manga"
                                                        hideUnseenCountBadge
                                                        hideAnilistEntryEditButton
                                                        overlay={<p
                                                            className="font-semibold text-white bg-gray-950 z-[-1] absolute right-0 w-fit px-4 py-1.5 text-center !bg-opacity-90 text-sm lg:text-base rounded-none rounded-bl-lg"
                                                        >{nb} chapter{nb === 1 ? "" : "s"}</p>}
                                                    />
                                                </div>
                                            )
                                        })}
                                </div>
                            )}
                        </>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    )
}
