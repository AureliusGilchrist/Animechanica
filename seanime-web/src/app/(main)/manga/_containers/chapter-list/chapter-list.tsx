import { AL_MangaDetailsById_Media, HibikeManga_ChapterDetails, Manga_Entry, Manga_MediaDownloadData } from "@/api/generated/types"
import { useEmptyMangaEntryCache } from "@/api/hooks/manga.hooks"
import { SeaCommandInjectableItem, useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { ChapterListBulkActions } from "@/app/(main)/manga/_containers/chapter-list/_components/chapter-list-bulk-actions"
import { DownloadedChapterList, manga_downloadedChapterContainerAtom } from "@/app/(main)/manga/_containers/chapter-list/downloaded-chapter-list"
import { MangaManualMappingModal } from "@/app/(main)/manga/_containers/chapter-list/manga-manual-mapping-modal"
import { ChapterReaderDrawer } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer"
import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useHandleMangaChapters } from "@/app/(main)/manga/_lib/handle-manga-chapters"
import { useHandleDownloadMangaChapter, useMangaEntryDownloadedChapters } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { getChapterNumberFromChapter, getDecimalFromChapter, useMangaChapterListRowSelection, useMangaDownloadDataUtils } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { LANGUAGES_LIST } from "@/app/(main)/manga/_lib/language-map"
import { cn } from "@/components/ui/core/styling"
import { monochromeCheckboxClasses } from "@/components/shared/classnames"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { LuffyError } from "@/components/shared/luffy-error"
import { Button, IconButton } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useUpdateEffect } from "@/components/ui/core/hooks"
import { DataGrid, defineDataGridColumns } from "@/components/ui/datagrid"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Select } from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import { useAtom, useSetAtom } from "jotai/react"
import React from "react"
import { FaRedo } from "react-icons/fa"
import { GiOpenBook } from "react-icons/gi"
import { IoBookOutline, IoLibrary } from "react-icons/io5"
import { LuArrowDownUp, LuBookOpen, LuSearch } from "react-icons/lu"
import { MdOutlineDownloadForOffline, MdOutlineOfflinePin } from "react-icons/md"

type ChapterListProps = {
    mediaId: string | null
    entry: Manga_Entry
    details: AL_MangaDetailsById_Media | undefined
    downloadData: Manga_MediaDownloadData | undefined
    downloadDataLoading: boolean
}

export function ChapterList(props: ChapterListProps) {

    const {
        mediaId,
        entry,
        details,
        downloadData,
        downloadDataLoading,
        ...rest
    } = props

    /**
     * Find chapter container
     */
    const {
        selectedExtension,
        providerExtensionsLoading,
        // Selected provider
        providerOptions, // For dropdown
        selectedProvider, // Current provider (id)
        setSelectedProvider,
        // Filters
        selectedFilters,
        setSelectedLanguage,
        setSelectedScanlator,
        languageOptions,
        scanlatorOptions,
        // Chapters
        chapterContainer,
        chapterContainerLoading,
        chapterContainerError,
    } = useHandleMangaChapters(mediaId)


    // Keep track of chapter numbers as integers (from source's chapter string)
    // This is used to filter the chapters
    // [id]: number
    const chapterIdToNumbersMap = React.useMemo(() => {
        const map = new Map<string, number>()

        for (const chapter of chapterContainer?.chapters ?? []) {
            map.set(chapter.id, getChapterNumberFromChapter(chapter.chapter))
        }

        return map
    }, [chapterContainer?.chapters])

    // Calculate sequential chapter numbers based on the actual chapter numbers
    // This gives us the correct "Chapter 652" style numbering regardless of source order
    // For decimal chapters (e.g., 50.5), use the integer part
    // For non-decimal chapters, sort by chapter number and assign sequential numbers
    const chapterIdToSequentialNumberMap = React.useMemo(() => {
        const map = new Map<string, number>()
        const chapters = chapterContainer?.chapters ?? []
        
        // Separate decimal and non-decimal chapters
        const nonDecimalChapters: { id: string, num: number }[] = []
        const decimalChapters: { id: string, intPart: number }[] = []
        
        for (const chapter of chapters) {
            const chapterStr = chapter.chapter
            const num = getDecimalFromChapter(chapterStr)
            
            if (chapterStr.includes(".")) {
                decimalChapters.push({ id: chapter.id, intPart: Math.floor(num) })
            } else {
                nonDecimalChapters.push({ id: chapter.id, num })
            }
        }
        
        // Sort non-decimal chapters by their actual chapter number (ascending)
        nonDecimalChapters.sort((a, b) => a.num - b.num)
        
        // Assign sequential numbers based on sorted order
        for (let i = 0; i < nonDecimalChapters.length; i++) {
            map.set(nonDecimalChapters[i].id, i + 1)
        }
        
        // For decimal chapters, use the integer part
        for (const dc of decimalChapters) {
            map.set(dc.id, dc.intPart)
        }

        return map
    }, [chapterContainer?.chapters])

    const [showUnreadChapter, setShowUnreadChapter] = React.useState(false)
    const [showDownloadedChapters, setShowDownloadedChapters] = React.useState(false)
    const [isReversed, setIsReversed] = React.useState(() => {
        // Restore sort order from localStorage
        if (typeof window !== "undefined" && mediaId) {
            const saved = localStorage.getItem(`manga-chapter-list-reversed-${mediaId}`)
            return saved === "true"
        }
        return false
    })
    const [paginationState, setPaginationState] = React.useState(() => {
        // Restore pagination state from localStorage
        if (typeof window !== "undefined" && mediaId) {
            const saved = localStorage.getItem(`manga-chapter-list-page-${mediaId}`)
            if (saved) {
                try {
                    const parsed = JSON.parse(saved) as { pageIndex?: number, pageSize?: number }
                    return { pageIndex: parsed.pageIndex ?? 0, pageSize: parsed.pageSize ?? 10 }
                } catch {}
            }
        }
        return { pageIndex: 0, pageSize: 10 }
    })

    // Persist sort order to localStorage
    React.useEffect(() => {
        if (mediaId) {
            localStorage.setItem(`manga-chapter-list-reversed-${mediaId}`, String(isReversed))
        }
    }, [isReversed, mediaId])

    // Persist pagination state to localStorage
    React.useEffect(() => {
        if (mediaId) {
            localStorage.setItem(`manga-chapter-list-page-${mediaId}`, JSON.stringify(paginationState))
        }
    }, [paginationState, mediaId])

    /**
     * Set selected chapter
     */
    const setSelectedChapter = useSetAtom(__manga_selectedChapterAtom)
    /**
     * Downloaded chapter container (for reading offline chapters)
     */
    const [downloadedChapterContainer, setDownloadedChapterContainer] = useAtom(manga_downloadedChapterContainerAtom)
    /**
     * Clear manga cache
     */
    const { mutate: clearMangaCache, isPending: isClearingMangaCache } = useEmptyMangaEntryCache()
    /**
     * Download chapter
     */
    const { downloadChapters, isSendingDownloadRequest } = useHandleDownloadMangaChapter(mediaId)
    /**
     * Download data utils
     */
    const {
        isChapterQueued,
        isChapterDownloaded,
        isChapterLocal,
    } = useMangaDownloadDataUtils(downloadData, downloadDataLoading)

    /**
     * Get all downloaded chapters for this entry
     */
    const downloadedChapters = useMangaEntryDownloadedChapters()

    /**
     * Check if a chapter has a downloaded version from the same provider
     */
    const getDownloadedChapterForSameProvider = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        if (!selectedProvider) return undefined
        // Find a downloaded chapter with the same provider and matching chapter number (using displayChapterNumber)
        return downloadedChapters.find(dc => 
            dc.provider === selectedProvider && 
            getDecimalFromChapter(dc.displayChapterNumber) === getDecimalFromChapter(chapter.chapter)
        )
    }, [downloadedChapters, selectedProvider])

    /**
     * Check if a chapter is downloaded from the current provider
     */
    const isChapterDownloadedFromSameProvider = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        return !!getDownloadedChapterForSameProvider(chapter)
    }, [getDownloadedChapterForSameProvider])

    const { inject, remove } = useSeaCommandInject()

    /**
     * Function to check if a chapter is read (based on user's progress)
     * Uses the sequential chapter number (calculated from position in full list) for comparison
     */
    const isChapterRead = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        if (!entry.listData || !entry.listData?.progress) return false

        // Use the sequential number calculated from position in the full chapter list
        const sequentialNum = chapterIdToSequentialNumberMap.get(chapter.id)
        if (sequentialNum !== undefined) {
            return sequentialNum <= entry.listData.progress
        }

        // Fall back to the source's chapter number if not in sequential map
        if (!chapterIdToNumbersMap.has(chapter.id)) return false
        const chapterNumber = chapterIdToNumbersMap.get(chapter.id)
        return !!chapterNumber && chapterNumber <= entry.listData?.progress
    }, [chapterIdToNumbersMap, chapterIdToSequentialNumberMap, entry])

    /**
     * Function to filter unread chapters
     */
    const retainUnreadChapters = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        return !isChapterRead(chapter)
    }, [isChapterRead])

    const confirmReloadSource = useConfirmationDialog({
        title: "Reload sources",
        actionIntent: "primary",
        actionText: "Reload",
        description: "This action will empty the cache for this manga and fetch the latest data from the selected source.",
        onConfirm: () => {
            if (mediaId) {
                clearMangaCache({ mediaId: Number(mediaId) })
            }
        },
    })

    /**
     * Handle clicking read - use downloaded version if available from same provider
     */
    const handleReadChapter = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        const downloadedVersion = getDownloadedChapterForSameProvider(chapter)
        if (downloadedVersion) {
            // Use the downloaded version
            setDownloadedChapterContainer({
                mediaId: Number(mediaId),
                provider: downloadedVersion.provider,
                chapters: [],
            })
            setSelectedChapter({
                chapterId: downloadedVersion.chapterId,
                chapterNumber: downloadedVersion.chapterNumber,
                provider: downloadedVersion.provider,
                mediaId: Number(mediaId),
            })
        } else {
            // Use the online version
            setSelectedChapter({
                chapterId: chapter.id,
                chapterNumber: chapter.chapter,
                provider: chapter.provider,
                mediaId: Number(mediaId),
            })
        }
    }, [getDownloadedChapterForSameProvider, setDownloadedChapterContainer, setSelectedChapter, mediaId])

    /**
     * Chapter columns
     */
    const columns = React.useMemo(() => defineDataGridColumns<HibikeManga_ChapterDetails>(() => [
        {
            accessorKey: "title",
            header: "Name",
            size: 90,
            cell: ({ row }) => {
                const downloadedVersion = getDownloadedChapterForSameProvider(row.original)
                const isRead = isChapterRead(row.original)
                // Use the sequential number calculated from position in the full chapter list
                const sequentialNum = chapterIdToSequentialNumberMap.get(row.original.id)
                // If downloaded from same provider, show "Chapter {sequentialNum}" 
                const displayTitle = downloadedVersion && sequentialNum !== undefined
                    ? `Chapter ${sequentialNum}`
                    : row.original.title
                return (
                    <div className={cn(
                        "flex items-center gap-2",
                        isRead && "opacity-50"
                    )}>
                        {(downloadedVersion || isChapterQueued(row.original)) && (
                            <MdOutlineOfflinePin 
                                className={cn(
                                    "text-lg flex-shrink-0",
                                    downloadedVersion ? "text-[--green]" : "text-white"
                                )}
                                title={downloadedVersion ? `Downloaded (Source: ${row.original.title})` : "Queued"} 
                            />
                        )}
                        <span title={downloadedVersion ? `Source: ${row.original.title}` : undefined}>
                            {displayTitle}
                        </span>
                    </div>
                )
            },
        },
        ...(selectedExtension?.settings?.supportsMultiScanlator ? [{
            id: "scanlator",
            header: "Scanlator",
            size: 40,
            accessorFn: (row: any) => row.scanlator,
            enableSorting: true,
        }] : []),
        ...(selectedExtension?.settings?.supportsMultiLanguage ? [{
            id: "language",
            header: "Language",
            size: 20,
            accessorFn: (row: any) => LANGUAGES_LIST[row.language]?.nativeName || row.language,
            enableSorting: true,
        }] : []),
        {
            id: "number",
            header: "Number",
            size: 10,
            enableSorting: true,
            accessorFn: (row) => {
                return chapterIdToNumbersMap.get(row.id)
            },
        },
        {
            id: "_actions",
            size: 10,
            enableSorting: false,
            enableGlobalFilter: false,
            cell: ({ row }) => {
                const isDownloadedSameProvider = isChapterDownloadedFromSameProvider(row.original)
                const isRead = isChapterRead(row.original)
                return (
                    <div className={cn(
                        "flex justify-end gap-2 items-center w-full",
                        isRead && "opacity-50"
                    )}>
                        {(!isChapterLocal(row.original) && !isChapterDownloaded(row.original) && !isChapterQueued(row.original)) && <IconButton
                            intent="gray-basic"
                            size="sm"
                            disabled={isSendingDownloadRequest}
                            onClick={() => downloadChapters([row.original])}
                            icon={<MdOutlineDownloadForOffline className="text-2xl" />}
                        />}
                        <IconButton
                            intent="gray-subtle"
                            size="sm"
                            onClick={() => handleReadChapter(row.original)}
                            icon={<GiOpenBook />}
                            title={isDownloadedSameProvider ? "Read offline" : "Read online"}
                        />
                    </div>
                )
            },
        },
    ]), [chapterIdToNumbersMap, chapterIdToSequentialNumberMap, selectedExtension, isSendingDownloadRequest, isChapterDownloaded, getDownloadedChapterForSameProvider, isChapterRead, downloadData, mediaId, handleReadChapter])

    const unreadChapters = React.useMemo(() => chapterContainer?.chapters?.filter(ch => retainUnreadChapters(ch)) ?? [], [chapterContainer, entry])
    // Default: newest first (reversed from original oldest-first order)
    // When isReversed: oldest first (original order)
    const allChapters = React.useMemo(() => {
        const original = chapterContainer?.chapters ?? []
        return isReversed ? [...original] : original.toReversed()
    }, [chapterContainer, isReversed])

    /**
     * Set "showUnreadChapter" state if there are unread chapters
     */
    useUpdateEffect(() => {
        setShowUnreadChapter(!!unreadChapters.length)
    }, [unreadChapters?.length])

    /**
     * Reset page index when filtering changes to avoid showing empty pages
     */
    const chaptersLengthRef = React.useRef<number | null>(null)
    React.useEffect(() => {
        // Reset to page 0 when filter toggles change
        setPaginationState(prev => ({ ...prev, pageIndex: 0 }))
    }, [showUnreadChapter, showDownloadedChapters])

    /**
     * Filter chapters based on state
     */
    const chapters = React.useMemo(() => {
        let d = showUnreadChapter ? unreadChapters : allChapters
        if (showDownloadedChapters) {
            d = d.filter(ch => isChapterDownloaded(ch) || isChapterQueued(ch))
        }
        // Apply sort order to unread chapters too
        if (showUnreadChapter && isReversed) {
            d = [...d].reverse()
        }
        return d
    }, [
        showUnreadChapter, unreadChapters, allChapters, showDownloadedChapters, downloadData, selectedExtension, isReversed,
    ])
    
    /**
     * Clamp page index when chapters length changes to prevent empty pages
     */
    React.useEffect(() => {
        if (chaptersLengthRef.current !== null && chaptersLengthRef.current !== chapters.length) {
            setPaginationState(prev => {
                const maxPageIndex = Math.max(0, Math.ceil(chapters.length / prev.pageSize) - 1)
                if (prev.pageIndex > maxPageIndex) {
                    return { ...prev, pageIndex: maxPageIndex }
                }
                return prev
            })
        }
        chaptersLengthRef.current = chapters.length
    }, [chapters.length])

    /**
     * Find the current reading position (first unread chapter) and calculate page index
     */
    const currentReadingPosition = React.useMemo(() => {
        if (!entry.listData?.progress || !chapters.length) return null
        
        const progress = entry.listData.progress
        // Find the first chapter that is unread (sequential number > progress)
        const firstUnreadIndex = chapters.findIndex(ch => {
            const seqNum = chapterIdToSequentialNumberMap.get(ch.id)
            return seqNum !== undefined && seqNum > progress
        })
        
        if (firstUnreadIndex === -1) return null
        
        return {
            index: firstUnreadIndex,
            pageIndex: Math.floor(firstUnreadIndex / paginationState.pageSize),
            chapter: chapters[firstUnreadIndex],
        }
    }, [chapters, entry.listData?.progress, chapterIdToSequentialNumberMap, paginationState.pageSize])

    /**
     * Jump to current reading position
     */
    const jumpToCurrentPosition = React.useCallback(() => {
        if (currentReadingPosition) {
            setPaginationState(prev => ({ ...prev, pageIndex: currentReadingPosition.pageIndex }))
        }
    }, [currentReadingPosition])

    const {
        rowSelectedChapters,
        onRowSelectionChange,
        rowSelection,
        setRowSelection,
        resetRowSelection,
    } = useMangaChapterListRowSelection()

    React.useEffect(() => {
        resetRowSelection()
    }, [])

    // Inject chapter list command
    React.useEffect(() => {
        if (!chapterContainer?.chapters?.length) return

        const nextChapter = unreadChapters[0]
        const upcomingChapters = unreadChapters.slice(0, 10)

        const commandItems: SeaCommandInjectableItem[] = [
            // Next chapter
            ...(nextChapter ? [{
                data: nextChapter,
                id: `next-chapter-${nextChapter.id}`,
                value: `${nextChapter.chapter}`,
                heading: "Next Chapter",
                priority: 2,
                render: () => {
                    const isDownloaded = isChapterDownloadedFromSameProvider(nextChapter)
                    return (
                        <div className="flex gap-1 items-center w-full">
                            {isDownloaded && <MdOutlineOfflinePin className="text-[--green]" />}
                            <p className="max-w-[70%] truncate">
                                Chapter {nextChapter.chapter}
                            </p>
                            {nextChapter.scanlator && (
                                <p className="text-[--muted]">({nextChapter.scanlator})</p>
                            )}
                        </div>
                    )
                },
                onSelect: ({ ctx }) => {
                    handleReadChapter(nextChapter)
                    ctx.close()
                },
            } as SeaCommandInjectableItem] : []),
            // Upcoming chapters
            ...upcomingChapters.map(chapter => {
                const isDownloaded = isChapterDownloadedFromSameProvider(chapter)
                return {
                    data: chapter,
                    id: `chapter-${chapter.id}`,
                    value: `${chapter.chapter}`,
                    heading: "Upcoming Chapters",
                    priority: 1,
                    render: () => (
                        <div className="flex gap-1 items-center w-full">
                            {isDownloaded && <MdOutlineOfflinePin className="text-[--green]" />}
                            <p className="max-w-[70%] truncate">
                                Chapter {chapter.chapter}
                            </p>
                            {chapter.scanlator && (
                                <p className="text-[--muted]">({chapter.scanlator})</p>
                            )}
                        </div>
                    ),
                    onSelect: ({ ctx }) => {
                        handleReadChapter(chapter)
                        ctx.close()
                    },
                } as SeaCommandInjectableItem
            }),
        ]

        inject("manga-chapters", {
            items: commandItems,
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase()) ||
                    (item.data.title?.toLowerCase() || "").includes(input.toLowerCase())
            },
            priority: 100,
        })

        return () => remove("manga-chapters")
    }, [chapterContainer?.chapters, unreadChapters, mediaId, isChapterDownloadedFromSameProvider, handleReadChapter])

    if (providerExtensionsLoading) return <LoadingSpinner />

    return (
        <div
            className="space-y-4"
            data-chapter-list-container
            data-selected-filters={JSON.stringify(selectedFilters)}
            data-selected-provider={JSON.stringify(selectedProvider)}
        >

            <div data-chapter-list-header-container className="flex flex-wrap gap-2 items-center">
                <Select
                    fieldClass="w-fit"
                    options={providerOptions}
                    value={selectedProvider || ""}
                    onValueChange={v => setSelectedProvider({
                        mId: mediaId,
                        provider: v,
                    })}
                    leftAddon="Source"
                    size="sm"
                    disabled={isClearingMangaCache}
                />

                <Button
                    leftIcon={<FaRedo />}
                    intent="gray-outline"
                    onClick={() => confirmReloadSource.open()}
                    loading={isClearingMangaCache}
                    size="sm"
                >
                    Reload sources
                </Button>

                <MangaManualMappingModal entry={entry}>
                    <Button
                        leftIcon={<LuSearch className="text-lg" />}
                        intent="gray-outline"
                        size="sm"
                    >
                        Manual match
                    </Button>
                </MangaManualMappingModal>
            </div>

            {(selectedExtension?.settings?.supportsMultiLanguage || selectedExtension?.settings?.supportsMultiScanlator) && (
                <div data-chapter-list-header-filters-container className="flex gap-2 items-center">
                    {selectedExtension?.settings?.supportsMultiScanlator && (
                        <>
                            <Select
                                fieldClass="w-64"
                                options={scanlatorOptions}
                                placeholder="All"
                                value={selectedFilters.scanlators[0] || ""}
                                onValueChange={v => setSelectedScanlator({
                                    mId: mediaId,
                                    scanlators: [v],
                                })}
                                leftAddon="Scanlator"
                                // intent="filled"
                                // size="sm"
                            />
                        </>
                    )}
                    {selectedExtension?.settings?.supportsMultiLanguage && (
                        <Select
                            fieldClass="w-64"
                            options={languageOptions}
                            placeholder="All"
                            value={selectedFilters.language}
                            onValueChange={v => setSelectedLanguage({
                                mId: mediaId,
                                language: v,
                            })}
                            leftAddon="Language"
                            // intent="filled"
                            // size="sm"
                        />
                    )}
                </div>
            )}

            {(chapterContainerLoading || isClearingMangaCache) ? <LoadingSpinner /> : (
                chapterContainerError ? <LuffyError title="No chapters found">
                    <MangaManualMappingModal entry={entry}>
                        <Button
                            leftIcon={<LuSearch className="text-lg" />}
                            intent="gray-outline"
                            size="md"
                        >
                            Manual match
                        </Button>
                    </MangaManualMappingModal>
                </LuffyError> : (
                    <>

                        {chapterContainer?.chapters?.length === 0 && (
                            <LuffyError title="No chapters found"><p>Try another source</p></LuffyError>
                        )}

                        {!!chapterContainer?.chapters?.length && (
                            <>
                                <div data-chapter-list-header-container className="flex gap-2 items-center w-full pb-2">
                                    <h2 className="px-1">Chapters</h2>
                                    <div className="flex flex-1"></div>
                                    <div>
                                        {!!unreadChapters?.length && <Button
                                            intent="white"
                                            rounded
                                            leftIcon={<IoBookOutline />}
                                            onClick={() => handleReadChapter(unreadChapters[0])}
                                        >
                                            Continue reading
                                        </Button>}
                                    </div>
                                </div>

                                <div data-chapter-list-bulk-actions-container className="space-y-4 border rounded-[--radius-md] bg-[--paper] p-4">

                                    <div data-chapter-list-bulk-actions-checkboxes-container className="flex flex-wrap items-center gap-4">
                                        <Checkbox
                                            label="Show unread"
                                            value={showUnreadChapter}
                                            onValueChange={v => setShowUnreadChapter(v as boolean)}
                                            fieldClass="w-fit"
                                            {...monochromeCheckboxClasses}
                                        />
                                        {selectedProvider !== "local-manga" && <Checkbox
                                            label={<span className="flex gap-2 items-center"><IoLibrary /> Show downloaded</span>}
                                            value={showDownloadedChapters}
                                            onValueChange={v => setShowDownloadedChapters(v as boolean)}
                                            fieldClass="w-fit"
                                            {...monochromeCheckboxClasses}
                                        />}
                                        
                                        <div className="flex items-center gap-2 ml-auto">
                                            <Tooltip trigger={
                                                <IconButton
                                                    intent="gray-subtle"
                                                    size="sm"
                                                    icon={<LuArrowDownUp />}
                                                    onClick={() => setIsReversed(prev => !prev)}
                                                />
                                            }>
                                                {isReversed ? "Showing oldest first" : "Showing newest first"} - Click to reverse
                                            </Tooltip>
                                            
                                            {currentReadingPosition && (
                                                <Tooltip trigger={
                                                    <IconButton
                                                        intent="primary-subtle"
                                                        size="sm"
                                                        icon={<LuBookOpen />}
                                                        onClick={jumpToCurrentPosition}
                                                    />
                                                }>
                                                    Jump to current position (Chapter {chapterIdToSequentialNumberMap.get(currentReadingPosition.chapter.id)})
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>

                                    <ChapterListBulkActions
                                        rowSelectedChapters={rowSelectedChapters}
                                        onDownloadSelected={chapters => {
                                            downloadChapters(chapters)
                                            resetRowSelection()
                                        }}
                                    />

                                    <DataGrid<HibikeManga_ChapterDetails>
                                        columns={columns}
                                        data={chapters}
                                        rowCount={chapters.length}
                                        isLoading={chapterContainerLoading}
                                        rowSelectionPrimaryKey="id"
                                        enableRowSelection={row => (!isChapterDownloaded(row.original) && !isChapterQueued(row.original))}
                                        state={{
                                            rowSelection,
                                            pagination: paginationState,
                                        }}
                                        onPaginationChange={setPaginationState}
                                        hideColumns={[
                                            {
                                                below: 1000,
                                                hide: ["number"],
                                            },
                                            {
                                                below: 600,
                                                hide: ["scanlator", "language"],
                                            },
                                        ]}
                                        onRowSelect={onRowSelectionChange}
                                        onRowSelectionChange={setRowSelection}
                                        className=""
                                        tableClass="table-fixed lg:table-fixed"
                                    />
                                </div>
                            </>
                        )}

                    </>
                )
            )}

            {(chapterContainer || downloadedChapterContainer) && <ChapterReaderDrawer
                entry={entry}
                chapterContainer={chapterContainer || downloadedChapterContainer!}
                chapterIdToNumbersMap={chapterIdToNumbersMap}
            />}

            {/* DEPRECATED: Separate Downloaded Chapters list - now integrated into main chapter list
             * Downloaded chapters are now shown inline with green offline pin icon and sequential numbering.
             * To restore this feature, uncomment the DownloadedChapterList component below.
             * See memory for details on restoring this feature.
             */}
            {/* <DownloadedChapterList
                entry={entry}
                data={downloadData}
            /> */}

            <ConfirmationDialog {...confirmReloadSource} />
        </div>
    )
}

