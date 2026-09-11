import type { FieldErrors, FieldValues, Resolver } from "react-hook-form"
import type { ZodType } from "zod"

/**
 * Minimal zod → react-hook-form bridge. `@hookform/resolvers` isn't
 * installed and Phase 3B must not add dependencies — this reproduces just
 * the piece of it these forms need (react-hook-form + zod are both already
 * installed, unused, since Phase 1).
 */
export function zodResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return async (values) => {
    const result = schema.safeParse(values)
    if (result.success) {
      return { values: result.data, errors: {} }
    }

    const errors: FieldErrors<T> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") as keyof T
      if (!errors[path]) {
        // @ts-expect-error — react-hook-form's FieldErrors typing doesn't
        // narrow well against a generic path; the shape itself is correct.
        errors[path] = { type: issue.code, message: issue.message }
      }
    }
    return { values: {}, errors }
  }
}
