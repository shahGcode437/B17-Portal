/**
 * Moves to the first field with a problem. `order` lists the fields as they appear on screen; ids are
 * `${prefix}-${field}`. A radio group has its id on the `fieldset`.
 */
export function focusFirstProblem(prefix: string, order: string[], problems: Record<string, string | undefined>): void {
  const first = order.find((field) => problems[field])
  if (!first) return
  const element = document.getElementById(`${prefix}-${first}`)
  element?.scrollIntoView({ block: "center" })
  element?.focus({ preventScroll: true })
}

/** After a change, the button pressed may no longer exist. Don't leave the keyboard nowhere. */
export function focusIfLost(id: string): void {
  setTimeout(() => {
    const active = document.activeElement
    if (!active || active === document.body) document.getElementById(id)?.focus()
  }, 0)
}
