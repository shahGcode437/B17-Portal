import { TriangleAlert, WifiOff } from "lucide-react"
import { EmptyState } from "@/components/feedback/EmptyState"
import { readErrorCopy } from "@/components/feedback/readErrorCopy"
import type { ApiError } from "@/lib/api/errors"

interface ReadErrorProps {
  error: ApiError
  /** Offered only when a retry can help (network, 429, 5xx). */
  onRetry?: () => void
  /** Heading level: 1 when the error replaces the whole page. */
  headingLevel?: 1 | 2 | 3
  /** Replaces the default title for a context-specific one ("Couldn't load your saved items"). */
  title?: string
}

/**
 * The state of a page or section whose server read FAILED (Phase 12G). It is deliberately a
 * different thing from an empty result: it says the request failed, never "0 results", never shows
 * raw backend text or JSON, and offers "Try again" only when that can help. It is announced to
 * assistive technology as an alert.
 */
function ReadError({ error, onRetry, headingLevel = 2, title }: ReadErrorProps) {
  const copy = readErrorCopy(error)
  return (
    <div role="alert" data-error-code={error.code}>
      <EmptyState
        headingLevel={headingLevel}
        icon={error.isNetwork ? WifiOff : TriangleAlert}
        title={title ?? copy.title}
        description={copy.description}
        actionLabel={copy.retryable && onRetry ? "Try again" : undefined}
        onAction={copy.retryable ? onRetry : undefined}
      />
    </div>
  )
}

export { ReadError }
