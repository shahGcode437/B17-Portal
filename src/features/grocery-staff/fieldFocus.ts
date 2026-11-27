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

/** The id of the actions panel's heading: where focus goes when the button that was used has gone. */
export const ACTIONS_HEADING_ID = "staff-actions"

/** After a change, the button pressed may no longer exist. Don't leave the keyboard nowhere. */
export function focusActionsIfLost(): void {
  setTimeout(() => {
    const active = document.activeElement
    if (!active || active === document.body) document.getElementById(ACTIONS_HEADING_ID)?.focus()
  }, 0)
}
