import type { GroceryScheduleDto, GrocerySubstitutionDto, GroceryConfirmationMethodDto } from "@/lib/api/dto/grocery"

/** Money is a whole number of paisa (API_CONTRACT §19.5): split into rupees and paisa with integers only. */
export function formatPaisa(paisa: number): string {
  const rest = paisa % 100
  const rupees = ((paisa - rest) / 100).toLocaleString("en-US")
  return rest === 0 ? `Rs ${rupees}` : `Rs ${rupees}.${String(rest).padStart(2, "0")}`
}

/** Grocery times are B-17's: every order timestamp is shown in Pakistan time, like the opening hours. */
const STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Karachi",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
})
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short", year: "numeric" })

export function formatStamp(iso: string): string {
  return STAMP.format(new Date(iso))
}

export function formatDay(iso: string): string {
  return DAY.format(new Date(iso))
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** ISO weekday numbers (1 = Monday) as words: "Every day", "Monday to Saturday" or a list. */
export function formatDays(days: number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (sorted.length === 7) return "Every day"
  const names = sorted.map((d) => WEEKDAYS[d - 1])
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (consecutive && sorted.length > 2) return `${names[0]} to ${names[names.length - 1]}`
  return names.join(", ")
}

/** `"20:00"` → `"8:00 pm"`. Text only: no time-zone arithmetic. */
export function formatClock(clock: string): string {
  const [hours, minutes] = clock.split(":").map(Number)
  const suffix = hours < 12 ? "am" : "pm"
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")} ${suffix}`
}

export function timeZoneLabel(timezone: string): string {
  return timezone === "Asia/Karachi" ? "Pakistan time" : timezone
}

export function formatHours(schedule: GroceryScheduleDto): string {
  return `${formatClock(schedule.opensAt)} to ${formatClock(schedule.closesAt)} (${timeZoneLabel(schedule.timezone)})`
}

export const SUBSTITUTION_LABEL: Record<GrocerySubstitutionDto, string> = {
  allow: "A similar substitute is fine",
  ask: "Ask me before substituting",
  none: "No substitutes",
}

export const METHOD_LABEL: Record<GroceryConfirmationMethodDto, string> = {
  phone_call: "after a phone call",
  in_person: "after speaking in person",
  written_message: "after a written message",
}
