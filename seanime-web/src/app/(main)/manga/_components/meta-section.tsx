"use client"
import { AL_MangaDetailsById_Media, Manga_Entry } from "@/api/generated/types"
import {
    AnimeEntryRankings,
    MediaEntryAudienceScore,
    MediaEntryGenresList,
} from "@/app/(main)/_features/media/_components/media-entry-metadata-components"
import {
    MediaPageHeader,
    MediaPageHeaderDetailsContainer,
    MediaPageHeaderEntryDetails,
} from "@/app/(main)/_features/media/_components/media-page-header-components"
import { MediaSyncTrackButton } from "@/app/(main)/_features/media/_containers/media-sync-track-button"
import { MangaToReadButton } from "@/app/(main)/manga/_containers/manga-to-read-button"
import { SeaLink } from "@/components/shared/sea-link"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Tooltip } from "@/components/ui/tooltip"
import { getCustomSourceExtensionId, getCustomSourceMediaSiteUrl, isCustomSource } from "@/lib/server/utils"
import { ThemeMediaPageInfoBoxSize, useThemeSettings } from "@/lib/theme/hooks"
import React from "react"
import { BiExtension } from "react-icons/bi"
import { LuExternalLink } from "react-icons/lu"
import { SiAnilist } from "react-icons/si"
import { PluginMangaPageButtons } from "../../_features/plugin/actions/plugin-actions"


export function MetaSection(props: { entry: Manga_Entry | undefined, details: AL_MangaDetailsById_Media | undefined }) {

    const { entry, details } = props
    const ts = useThemeSettings()

    if (!entry?.media) return null

    const authors = React.useMemo(() => {
        const edges = details?.staff?.edges ?? []
        // First try to find authors/story creators
        let filtered = edges.filter(edge => {
            const role = edge?.role?.toLowerCase() || ""
            return role.includes("story") || role.includes("art") || role.includes("original creator")
        })
        // If none found, take the first few staff members
        if (filtered.length === 0) {
            filtered = edges.slice(0, 3)
        }
        return filtered
            .map(edge => ({
                id: edge?.node?.id,
                name: edge?.node?.name?.full ?? "Unknown",
                role: edge?.role,
            }))
            .filter(author => !!author.id && !!author.name)
    }, [details?.staff?.edges])

    const Details = () => (
        <>
            <div
                className={cn(
                    "flex gap-2 flex-wrap items-center",
                    ts.mediaPageBannerInfoBoxSize === ThemeMediaPageInfoBoxSize.Fluid && "justify-center lg:justify-start lg:max-w-[65vw]",
                )}
            >
                <MediaEntryAudienceScore meanScore={entry.media?.meanScore} badgeClass="bg-transparent" />

                <MediaEntryGenresList genres={details?.genres} type="manga" />
            </div>

            <AnimeEntryRankings rankings={details?.rankings} />

            {!!authors?.length && (
                <div
                    className="flex flex-wrap items-center gap-2 text-sm text-[--muted]"
                    data-manga-meta-section-authors
                >
                    <span className="uppercase tracking-wide text-xs text-[--muted]">
                        {authors.length > 1 ? "Authors" : "Author"}
                    </span>
                    {authors.map(author => (
                        <SeaLink
                            key={author.id}
                            href={`https://anilist.co/staff/${author.id}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-white/20 hover:border-white/60 transition-colors text-[--foreground]"
                        >
                            {author.name}
                            <LuExternalLink className="text-xs" />
                        </SeaLink>
                    ))}
                </div>
            )}
        </>
    )

    return (
        <MediaPageHeader
            backgroundImage={entry.media?.bannerImage}
            coverImage={entry.media?.coverImage?.extraLarge}
        >

            <MediaPageHeaderDetailsContainer>

                <MediaPageHeaderEntryDetails
                    coverImage={entry.media?.coverImage?.extraLarge || entry.media?.coverImage?.large}
                    title={entry.media?.title?.userPreferred}
                    englishTitle={entry.media?.title?.english}
                    romajiTitle={entry.media?.title?.romaji}
                    startDate={entry.media?.startDate}
                    season={entry.media?.season}
                    color={entry.media?.coverImage?.color}
                    progressTotal={entry.media?.chapters}
                    status={entry.media?.status}
                    description={entry.media?.description}
                    listData={entry.listData}
                    media={entry.media}
                    type="manga"
                >
                    {ts.mediaPageBannerInfoBoxSize === ThemeMediaPageInfoBoxSize.Fluid && <Details />}
                </MediaPageHeaderEntryDetails>

                {ts.mediaPageBannerInfoBoxSize !== ThemeMediaPageInfoBoxSize.Fluid && <Details />}


                <div className="w-full flex flex-wrap gap-4 items-center" data-manga-meta-section-buttons-container>

                    {isCustomSource(entry.mediaId) && (
                        <Tooltip
                            trigger={<div>
                                <SeaLink href={`/custom-sources?provider=${getCustomSourceExtensionId(entry.media)}`}>
                                    <IconButton size="sm" intent="gray-link" className="px-0" icon={<BiExtension className="text-lg" />} />
                                </SeaLink>
                            </div>}
                        >
                            Custom source
                        </Tooltip>
                    )}

                    {!isCustomSource(entry.mediaId) && <SeaLink href={`https://anilist.co/manga/${entry.mediaId}`} target="_blank">
                        <IconButton size="sm" intent="gray-link" className="px-0" icon={<SiAnilist className="text-lg" />} />
                    </SeaLink>}

                    {isCustomSource(entry.mediaId) && !!getCustomSourceMediaSiteUrl(entry.media) && <Tooltip
                        trigger={<div>
                            <SeaLink href={getCustomSourceMediaSiteUrl(entry.media)!} target="_blank">
                                <IconButton size="sm" intent="gray-link" className="px-0" icon={<LuExternalLink className="text-lg" />} />
                            </SeaLink>
                        </div>}
                    >
                        Open in website
                    </Tooltip>}

                    {ts.mediaPageBannerInfoBoxSize !== ThemeMediaPageInfoBoxSize.Fluid && <div className="flex-1 hidden lg:flex"></div>}

                    <MediaSyncTrackButton mediaId={entry.mediaId} type="manga" size="md" />

                    <MangaToReadButton mediaId={entry.mediaId} size="md" />

                    <PluginMangaPageButtons media={entry.media} />
                </div>

            </MediaPageHeaderDetailsContainer>
        </MediaPageHeader>

    )

}
