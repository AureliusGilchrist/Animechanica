"use client"
import { useAddMangaToReadItem, useIsMangaInToReadList, useRemoveMangaToReadItem } from "@/api/hooks/manga_to_read.hooks"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { IconButton } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import React from "react"
import { LuBookMarked, LuBookOpen } from "react-icons/lu"

type MangaToReadButtonProps = {
    mediaId: number
    size?: "sm" | "md" | "lg"
}

export function MangaToReadButton(props: MangaToReadButtonProps) {
    const {
        mediaId,
        size,
        ...rest
    } = props

    const { data: isInList, isLoading } = useIsMangaInToReadList(mediaId)
    const { mutate: addToList, isPending: isAdding } = useAddMangaToReadItem()
    const { mutate: removeFromList, isPending: isRemoving } = useRemoveMangaToReadItem()

    function handleToggle() {
        if (isInList) {
            removeFromList({ mediaId })
        } else {
            addToList({ mediaId })
        }
    }

    const confirmRemove = useConfirmationDialog({
        title: "Remove from reading list",
        description: "This will remove the manga from your reading list. Are you sure?",
        onConfirm: () => {
            handleToggle()
        },
    })

    return (
        <>
            <Tooltip
                trigger={<IconButton
                    icon={isInList ? <LuBookMarked /> : <LuBookOpen />}
                    onClick={() => isInList ? confirmRemove.open() : handleToggle()}
                    loading={isLoading || isAdding || isRemoving}
                    intent={isInList ? "primary-subtle" : "gray-subtle"}
                    size={size}
                    {...rest}
                />}
            >
                {isInList ? `Remove from reading list` : `Add to reading list`}
            </Tooltip>

            <ConfirmationDialog {...confirmRemove} />
        </>
    )
}
