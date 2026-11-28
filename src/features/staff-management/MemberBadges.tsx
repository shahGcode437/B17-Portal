import { CirclePause, ShieldCheck, TriangleAlert, UserCog } from "lucide-react"
import { StatusBadge } from "@/components/feedback/StatusBadge"
import { accountProblem, roleName } from "@/features/staff-management/staffLabels"
import type { StaffMemberDto } from "@/lib/api/dto/staffAdmin"

/** Role and state, each with an icon and words: never colour alone. */
function MemberBadges({ member, viewerId }: { member: StaffMemberDto; viewerId: string }) {
  const problem = accountProblem(member)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge
        tone={member.role === "admin" ? "success" : "info"}
        icon={member.role === "admin" ? ShieldCheck : UserCog}
        label={roleName(member.role)}
      />
      {member.paused && <StatusBadge tone="warning" icon={CirclePause} label="Paused" />}
      {problem && <StatusBadge tone="danger" icon={TriangleAlert} label={problem} />}
      {member.userId === viewerId && <span className="text-xs font-semibold text-primary">You</span>}
    </span>
  )
}

export { MemberBadges }
