import type { ReactNode } from "react"
import { ReadError } from "@/components/feedback/ReadError"
import type { ReadResult } from "@/hooks/useRead"

interface ReadBoundaryProps<T> {
  read: ReadResult<T>
  /** What to show while the first answer is on its way (skeleton cards, usually). */
  loading: ReactNode
  /** When this says the data is "empty", `empty` is shown instead of `children`. */
  isEmpty?: (data: T) => boolean
  /** The empty state; `null` hides the section entirely (a Home preview with nothing to preview). */
  empty?: ReactNode
  /** Heading level of the error state (3 inside a page section). */
  errorHeadingLevel?: 1 | 2 | 3
  /** A context-specific error title ("Couldn't load services"). */
  errorTitle?: string
  children: (data: T) => ReactNode
}

/**
 * The four honest states of a server read (Phase 12G), kept apart so none is mistaken for another:
 * LOADING (a placeholder - never "0 results"), ERROR (the request failed - with a retry when that can
 * help), EMPTY (the request succeeded and there is nothing), and the content. No state ever falls
 * back to local demo content.
 */
function ReadBoundary<T>({
  read,
  loading,
  isEmpty,
  empty = null,
  errorHeadingLevel = 3,
  errorTitle,
  children,
}: ReadBoundaryProps<T>) {
  if (read.status === "loading") return <>{loading}</>
  if (read.status === "error") {
    return <ReadError error={read.error} onRetry={read.retry} headingLevel={errorHeadingLevel} title={errorTitle} />
  }
  if (isEmpty?.(read.data)) return <>{empty}</>
  return <>{children(read.data)}</>
}

export { ReadBoundary }
