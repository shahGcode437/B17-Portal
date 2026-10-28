import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_GRADE_LENGTH } from "@/config/listingLimits"

interface TutorGradeFieldProps {
  value: string
  onChange: (value: string) => void
  /** The problem with the current value (see `gradeProblem`), shown once the person has tried to submit. */
  error: string | null
  disabled?: boolean
}

/**
 * The grade / level a tutor teaches. It sits beside the shared listing form (it is not one of its fields), so the
 * create AND the edit page render this one control and check it with `gradeProblem` (the edit page used to take
 * any text and leave the server to refuse it).
 */
function TutorGradeField({ value, onChange, error, disabled }: TutorGradeFieldProps) {
  return (
    <Stack gap={2}>
      <Label htmlFor="tutor-grade">Grade / level you teach</Label>
      <Input
        id="tutor-grade"
        placeholder="e.g. Grade 9 or O-Level"
        value={value}
        disabled={disabled}
        maxLength={MAX_GRADE_LENGTH + 20}
        aria-invalid={!!error}
        aria-describedby={error ? "tutor-grade-error" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <Typography id="tutor-grade-error" variant="caption" role="alert" className="text-destructive">
          {error}
        </Typography>
      )}
    </Stack>
  )
}

export { TutorGradeField }
