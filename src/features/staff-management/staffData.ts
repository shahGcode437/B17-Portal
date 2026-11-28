import { NotSent } from "@/hooks/useGuardedWrite"
import { ApiError } from "@/lib/api/errors"
import type { Page } from "@/lib/api/client"
import { fetchStaffRoster } from "@/lib/api/reads/staffAdmin"
import { getIdentityStamp } from "@/lib/api/session"
import { STAFF_CHANGED } from "@/features/staff-management/staffAdminErrors"
import { sameAccess } from "@/features/staff-management/staffLabels"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"

export const ROSTER_PAGE = 20
/** The API's largest page; used to look one person up, as it has no one-member read. */
const LOOKUP_PAGE = 100
/** The API accepts an offset up to 10,000. */
const LAST_OFFSET = 10_000

/** One staff member by id, found in the roster. `null`: no longer staff. */
export async function findMember(userId: string, signal?: AbortSignal, known?: Page<StaffMemberDto>): Promise<StaffMemberDto | null> {
  const here = known?.items.find((member) => member.userId === userId)
  if (here) return here
  for (let offset = 0; offset <= LAST_OFFSET; offset += LOOKUP_PAGE) {
    const page = await fetchStaffRoster({ limit: LOOKUP_PAGE, offset }, signal)
    const found = page.items.find((member) => member.userId === userId)
    if (found) return found
    if (offset + page.items.length >= page.meta.total || page.items.length === 0) break
  }
  return null
}

export interface StaffData {
  roster: Page<StaffMemberDto>
  /** The selected person, or `null` when none is selected or they are no longer staff. */
  member: StaffMemberDto | null
}

export async function loadStaffData(offset: number, selected: string | null, signal?: AbortSignal): Promise<StaffData> {
  const roster = await fetchStaffRoster({ limit: ROSTER_PAGE, offset }, signal)
  const member = selected ? await findMember(selected, signal, roster) : null
  return { roster, member }
}

/**
 * Run just BEFORE a change to an existing Moderator: read them again and stop if their access is no
 * longer what the change was decided on. The API takes no version for staff changes (a scope change
 * replaces the whole set), so this narrows the chance of overwriting another Super Admin's change;
 * it cannot close it. Any failure here means nothing was sent.
 *
 * Because it waits, it also stops if the signed-in account changed meanwhile: the change was decided
 * by the person who pressed the button, and would otherwise go out with the other account's token.
 */
export async function assertUnchanged(shown: StaffMemberDto, signal: AbortSignal): Promise<void> {
  const askedAs = getIdentityStamp()
  let now: StaffMemberDto | null
  try {
    now = await findMember(shown.userId, signal)
  } catch (cause) {
    throw new NotSent(cause as ApiError)
  }
  if (getIdentityStamp() !== askedAs) {
    throw new NotSent(new ApiError({ status: 409, code: "account_changed", message: "Not sent." }))
  }
  if (!now || !sameAccess(now, shown)) {
    throw new NotSent(new ApiError({ status: 409, code: STAFF_CHANGED, message: "Changed." }))
  }
}
