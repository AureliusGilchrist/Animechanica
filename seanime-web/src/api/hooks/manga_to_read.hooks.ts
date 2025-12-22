import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Nullish } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export function useGetMangaToReadList() {
    return useServerQuery<number[]>({
        endpoint: API_ENDPOINTS.MANGA_TO_READ.GetMangaToReadList.endpoint,
        method: API_ENDPOINTS.MANGA_TO_READ.GetMangaToReadList.methods[0],
        queryKey: [API_ENDPOINTS.MANGA_TO_READ.GetMangaToReadList.key],
        enabled: true,
    })
}

export function useAddMangaToReadItem() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, { mediaId: number }>({
        endpoint: API_ENDPOINTS.MANGA_TO_READ.AddMangaToReadItem.endpoint,
        method: API_ENDPOINTS.MANGA_TO_READ.AddMangaToReadItem.methods[0],
        mutationKey: [API_ENDPOINTS.MANGA_TO_READ.AddMangaToReadItem.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_TO_READ.GetMangaToReadList.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_TO_READ.IsMangaInToReadList.key] })
            // Also invalidate manga collection since we may have added the manga to AniList
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
            toast.success("Added to reading list")
        },
    })
}

export function useRemoveMangaToReadItem() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, { mediaId: number }>({
        endpoint: API_ENDPOINTS.MANGA_TO_READ.RemoveMangaToReadItem.endpoint,
        method: API_ENDPOINTS.MANGA_TO_READ.RemoveMangaToReadItem.methods[0],
        mutationKey: [API_ENDPOINTS.MANGA_TO_READ.RemoveMangaToReadItem.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_TO_READ.GetMangaToReadList.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_TO_READ.IsMangaInToReadList.key] })
            toast.success("Removed from reading list")
        },
    })
}

export function useIsMangaInToReadList(mediaId: Nullish<number>) {
    return useServerQuery<boolean, { mediaId: number }>({
        endpoint: API_ENDPOINTS.MANGA_TO_READ.IsMangaInToReadList.endpoint,
        method: API_ENDPOINTS.MANGA_TO_READ.IsMangaInToReadList.methods[0],
        queryKey: [API_ENDPOINTS.MANGA_TO_READ.IsMangaInToReadList.key, mediaId],
        data: { mediaId: mediaId! },
        enabled: !!mediaId,
    })
}
