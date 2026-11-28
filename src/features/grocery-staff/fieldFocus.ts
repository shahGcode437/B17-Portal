import { focusIfLost } from "@/lib/focus"

export { focusFirstProblem } from "@/lib/focus"

/** The id of the actions panel's heading: where focus goes when the button that was used has gone. */
export const ACTIONS_HEADING_ID = "staff-actions"

export function focusActionsIfLost(): void {
  focusIfLost(ACTIONS_HEADING_ID)
}
