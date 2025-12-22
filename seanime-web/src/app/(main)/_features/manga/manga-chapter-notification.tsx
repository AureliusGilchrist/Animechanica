import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { CloseButton } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useBoolean } from "@/hooks/use-disclosure"
import { WSEvents } from "@/lib/server/ws-events"
import React, { useState } from "react"
import { BiBookBookmark } from "react-icons/bi"

type MangaNewChaptersPayload = {
    manga: string[]
    totalQueued: number
}

export function MangaChapterNotification() {
    const [notification, setNotification] = useState<MangaNewChaptersPayload | null>(null)
    const visible = useBoolean(false)

    useWebsocketMessageListener<MangaNewChaptersPayload>({
        type: WSEvents.MANGA_NEW_CHAPTERS_FOUND,
        onMessage: data => {
            setNotification(data)
            visible.on()
            // Auto-hide after 30 seconds
            setTimeout(() => {
                visible.off()
            }, 30000)
        },
    })

    function handleClose() {
        visible.off()
        setNotification(null)
    }

    if (!visible.active || !notification) {
        return null
    }

    return (
        <div className="z-50 fixed bottom-4 right-4">
            <PageWrapper>
                <Card className="w-full max-w-[400px] min-h-[120px] relative bg-gray-950 border-brand-500/50">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <BiBookBookmark className="text-brand-400" />
                            New Manga Chapters
                        </CardTitle>
                        <CardDescription className="flex flex-col gap-1 text-base">
                            {notification.manga.length === 1 ? (
                                <span>{notification.manga[0]}</span>
                            ) : notification.manga.length <= 3 ? (
                                notification.manga.map((m, i) => (
                                    <span key={i} className="text-sm">{m}</span>
                                ))
                            ) : (
                                <span>
                                    {notification.manga.length} series have new chapters
                                </span>
                            )}
                            <span className="text-xs text-gray-400 mt-1">
                                {notification.totalQueued} chapter{notification.totalQueued !== 1 ? "s" : ""} queued for download
                            </span>
                        </CardDescription>
                    </CardHeader>
                    <CloseButton className="absolute top-2 right-2" onClick={handleClose} />
                </Card>
            </PageWrapper>
        </div>
    )
}
