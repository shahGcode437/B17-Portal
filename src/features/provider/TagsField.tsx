import type { UseFormRegisterReturn } from "react-hook-form"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FieldError } from "@/components/forms/FieldError"
import { MAX_TAGS, MAX_TAG_LENGTH } from "@/config/listingLimits"
import { parseTags, tagsProblem } from "@/features/provider/listingSchema"

interface TagsFieldProps {
  id: string
  /** The field label, which already says what the tags are for on this kind of listing. */
  label: string
  placeholder: string
  /** One sentence on what the tags do for this kind (they are shown on the page and matched by search). */
  purpose: string
  /** The field's current text (watched by the form), for the live count. */
  value: string | undefined
  /** A problem reported after a submit (the schema's message); the live check below fills in before that. */
  error?: string
  inputProps: UseFormRegisterReturn
}

/**
 * The free-text tags field (Phase 12S, S4; VR5 adds a live chip preview). Tags are OPTIONAL (the API's `tags`
 * defaults to none) and bounded the way the API bounds them: at most 20, each at most 40 characters, blanks and
 * repeats ignored. The count and the problem are computed from the SAME parser the payload uses, so the form never
 * accepts what the API would refuse and no raw validation text from the server is ever needed for tags. The chip
 * list below the input is purely visual: the comma-separated text in the input is still the authoritative value.
 */
function TagsField({ id, label, placeholder, purpose, value, error, inputProps }: TagsFieldProps) {
  const tags = parseTags(value)
  const count = tags.length
  const problem = error ?? tagsProblem(value ?? "")
  return (
    <Stack gap={2}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        placeholder={placeholder}
        aria-invalid={!!problem}
        aria-describedby={problem ? `${id}-error` : `${id}-hint`}
        {...inputProps}
      />
      {tags.length > 0 && (
        <ul aria-label="Current tags" className="flex flex-wrap gap-1.5">
          {tags.map((tag, index) => (
            <li
              key={`${tag}-${index}`}
              className="inline-flex max-w-full items-center rounded-full bg-secondary/80 px-3 py-1 text-xs font-medium text-secondary-foreground"
            >
              <span className="truncate">{tag}</span>
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <FieldError id={`${id}-error`} message={problem} />
      ) : (
        <Typography id={`${id}-hint`} variant="caption" className="text-muted-foreground">
          {purpose} Separate with commas: up to {MAX_TAGS} tags of {MAX_TAG_LENGTH} characters
          {count > 0 ? ` (${count} of ${MAX_TAGS} so far)` : ""}.
        </Typography>
      )}
    </Stack>
  )
}

export { TagsField }
