import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError, NETWORK_ERROR_CODE, isApiError } from "@/lib/api/errors"
import { useRead } from "@/hooks/useRead"

/**
 * One page as the loader reports it. `raw` is how many rows the SERVER returned (the next `offset`
 * advances by it), which can exceed `items.length` when an entry of an unknown kind was skipped.
 */
export interface LoadedPage<T, X = undefined> {
  items: T[]
  raw: number
  /** The server's TRUE total, from `meta.total`. */
  total: number
  /** List-level metadata that comes with the first page (e.g. per-status counts). */
  extra: X
}

interface MorePages<T> {
  key: string
  items: T[]
  raw: number
  total: number
  loading: boolean
  error: ApiError | null
}

function toApiError(cause: unknown): ApiError {
  if (isApiError(cause)) return cause
  return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message: "The request could not be completed." })
}

/**
 * A server-paginated list with "Load more" (Phase 12G). `key` identifies the query (filters, sort):
 * when it changes the previous request is aborted, pages loaded for the old query are dropped and
 * the first page of the new one is requested - an old answer can never replace a newer one. `total`
 * is always the server's count, never the number of rows that happen to be loaded.
 */
export function usePagedRead<T, X = undefined>(
  key: string,
  load: (offset: number, signal: AbortSignal) => Promise<LoadedPage<T, X>>,
  options: { enabled?: boolean } = {}
) {
  const first = useRead(key, (signal) => load(0, signal), options)
  const [more, setMore] = useState<MorePages<T> | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  // A new query cancels a page still in flight (and `extra` below ignores pages of another key).
  useEffect(() => {
    return () => {
      moreController.current?.abort()
      moreController.current = null
    }
  }, [key])

  const extra = more && more.key === key ? more : null
  const items = first.status === "success" ? [...first.data.items, ...(extra?.items ?? [])] : []
  const total = extra ? extra.total : first.status === "success" ? first.data.total : 0

  const loadMore = useCallback(() => {
    if (first.status !== "success" || moreController.current) return
    const previous = more && more.key === key ? more : null
    const offset = first.data.raw + (previous?.raw ?? 0)
    const controller = new AbortController()
    moreController.current = controller
    const base: MorePages<T> = {
      key,
      items: previous?.items ?? [],
      raw: previous?.raw ?? 0,
      total: previous?.total ?? first.data.total,
      loading: true,
      error: null,
    }
    setMore(base)
    loadRef.current(offset, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        moreController.current = null
        setMore({
          ...base,
          items: [...base.items, ...page.items],
          raw: base.raw + page.raw,
          total: page.total,
          loading: false,
        })
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return
        moreController.current = null
        setMore({ ...base, loading: false, error: toApiError(cause) })
      }
    )
  }, [first, more, key])

  return {
    items,
    total,
    /** List-level metadata of the first page (undefined until it arrives). */
    extra: first.status === "success" ? first.data.extra : undefined,
    hasMore: first.status === "success" && items.length < total,
    loadMore,
    /** The first page is on its way. */
    loading: first.status === "loading",
    loadingMore: Boolean(extra?.loading),
    error: first.status === "error" ? first.error : null,
    moreError: extra?.error ?? null,
    retry: first.retry,
  }
}
