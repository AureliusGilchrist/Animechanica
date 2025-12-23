/**
 * Plugin Playback Notifications
 *
 * This module provides hooks to notify plugins when video playback starts or stops.
 * Plugins can use ctx.screen.onPlaybackStarted() and ctx.screen.onPlaybackStopped()
 * to listen for these events and react accordingly (e.g., stop playing theme music).
 */

import { useWebsocketSender } from "@/app/(main)/_hooks/handle-websockets"
import { PluginClientEvents } from "@/app/(main)/_features/plugin/generated/plugin-events"
import { useCallback, useRef } from "react"

export type PlaybackType = "local" | "onlinestream" | "torrentstream" | "debridstream" | "mediastream"

/**
 * Hook to send playback notification events to plugins.
 * Use this in video players to notify plugins when playback starts/stops.
 */
export function usePluginPlaybackNotifications() {
    const { sendPluginMessage } = useWebsocketSender()
    const hasNotifiedStartRef = useRef(false)

    /**
     * Notify plugins that playback has started.
     * This should be called when video starts playing.
     */
    const notifyPlaybackStarted = useCallback((mediaId: number, type: PlaybackType) => {
        if (hasNotifiedStartRef.current) return // Prevent duplicate notifications
        hasNotifiedStartRef.current = true

        sendPluginMessage(PluginClientEvents.PlaybackStarted, {
            mediaId,
            type,
        })
    }, [sendPluginMessage])

    /**
     * Notify plugins that playback has stopped.
     * This should be called when video stops playing or the player is closed.
     */
    const notifyPlaybackStopped = useCallback((mediaId: number, type: PlaybackType) => {
        hasNotifiedStartRef.current = false // Reset for next playback

        sendPluginMessage(PluginClientEvents.PlaybackStopped, {
            mediaId,
            type,
        })
    }, [sendPluginMessage])

    /**
     * Reset the notification state.
     * Call this when the player is unmounted or the media changes.
     */
    const resetNotificationState = useCallback(() => {
        hasNotifiedStartRef.current = false
    }, [])

    return {
        notifyPlaybackStarted,
        notifyPlaybackStopped,
        resetNotificationState,
    }
}
