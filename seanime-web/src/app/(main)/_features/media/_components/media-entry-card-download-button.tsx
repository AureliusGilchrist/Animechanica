import { useHasDebridService, useHasTorrentProvider, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Tooltip } from "@/components/ui/tooltip"
import { TORRENT_CLIENT } from "@/lib/server/settings"
import { useRouter } from "next/navigation"
import React from "react"
import { LuDownload } from "react-icons/lu"

type MediaEntryCardDownloadButtonProps = {
    mediaId: number
    isInLibrary?: boolean
    isDownloading?: boolean
    className?: string
}

/**
 * Download button for media cards (recommendations, relations, etc.)
 * Navigates to the anime page with download=true to open the torrent search drawer
 */
export function MediaEntryCardDownloadButton(props: MediaEntryCardDownloadButtonProps) {
    const { mediaId, isInLibrary, isDownloading, className } = props

    const router = useRouter()
    const serverStatus = useServerStatus()
    const { hasTorrentProvider } = useHasTorrentProvider()
    const { hasDebridService } = useHasDebridService()

    // Check if download functionality is available
    const canDownload = hasTorrentProvider && (
        serverStatus?.settings?.torrent?.defaultTorrentClient !== TORRENT_CLIENT.NONE
        || hasDebridService
    )

    // Don't show if already in library, downloading, or can't download
    if (isInLibrary || !canDownload) {
        return null
    }

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        // Navigate to the anime page with download parameter to open the torrent search drawer
        router.push(`/entry?id=${mediaId}&download=true`)
    }

    return (
        <Tooltip trigger={
            <IconButton
                intent="gray-subtle"
                size="sm"
                icon={isDownloading ? <LoadingSpinner className="w-4 h-4" /> : <LuDownload className="text-lg" />}
                className={cn(
                    "rounded-full bg-gray-900/80 hover:bg-gray-800",
                    isDownloading && "pointer-events-none",
                    className,
                )}
                onClick={handleClick}
            />
        }>
            {isDownloading ? "Downloading..." : "Download"}
        </Tooltip>
    )
}
