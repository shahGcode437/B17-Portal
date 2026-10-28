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

/** What was on screen for the last query that answered (see `keepPrevious`). */
interface Answered<T> {
  /** The identities that produced it: a new first page or a new "Load more" page makes a new answer. */
  source: unknown
  more: unknown
  items: T[]
  total: number
}

/**
 * A server-paginated list with "Load more" (Phase 12G). `key` identifies the query (filters, sort):
 * when it changes the previous request is aborted, pages loaded for the old query are dropped and
 * the first page of the new one is requested - an old answer can never replace a newer one. `total`
 * is always the server's count, never the number of rows that happen to be loaded.
 *
 * `keepPrevious` (Phase 12S, S4; opt-in, Search only): while the NEXT query's first page is in flight, keep
 * returning the last answer instead of an empty list, and say so with `refreshing`. A reader who is half-way
 * down the results keeps their context when a filter changes. It never changes what is TRUE about a query:
 * the new answer replaces the old the moment it arrives, an answer for any other key is still ignored, an
 * error drops the old rows at once, and a previous answer with no rows is not kept (the page would then claim
 * "no results" for a query that has not answered yet).
 */
export function usePagedRead<T, X = undefined>(
  key: string,
  load: (offset: number, signal: AbortSignal) => Promise<LoadedPage<T, X>>,
  options: { enabled?: boolean; keepPrevious?: boolean } = {}
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

  // The last answer that settled, for `keepPrevious` (adjusted during render, like SearchPage's location key).
  const [answered, setAnswered] = useState<Answered<T> | null>(null)
  if (options.keepPrevious) {
    if (first.status === "success") {
      if (!answered || answered.source !== first.data || answered.more !== extra) {
        setAnswered({ source: first.data, more: extra, items, total })
      }
    } else if (first.status === "error" && answered) {
      setAnswered(null) // an error replaces the rows; a later retry must not resurrect them
    }
  }
  const keeping = Boolean(options.keepPrevious && first.status === "loading" && answered && answered.items.length > 0)

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
    items: keeping ? answered!.items : items,
    total: keeping ? answered!.total : total,
    /** List-level metadata of the first page (undefined until it arrives). */
    extra: first.status === "success" ? first.data.extra : undefined,
    hasMore: first.status === "success" && items.length < total,
    loadMore,
    /** The first page is on its way and there is nothing to show meanwhile. */
    loading: first.status === "loading" && !keeping,
    /** The first page of a NEW query is on its way and the previous answer is still shown (`keepPrevious` only). */
    refreshing: keeping,
    loadingMore: Boolean(extra?.loading),
    error: first.status === "error" ? first.error : null,
    moreError: extra?.error ?? null,
    retry: first.retry,
  }
}
