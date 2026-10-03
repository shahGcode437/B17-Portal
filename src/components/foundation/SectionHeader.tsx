import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { cn } from "@/lib/utils"

interface SectionHeaderProps extends React.ComponentProps<"div"> {
  title: string
  description?: string
  viewAllLabel?: string
  viewAllPath?: string
}

/** Consistent title + optional "View all" link for every Home section. */
function SectionHeader({
  title,
  description,
  viewAllLabel = "View all",
  viewAllPath,
  className,
  ...props
}: SectionHeaderProps) {
  return (
    <Stack
      direction="row"
      align="end"
      justify="between"
      gap={4}
      className={cn("mb-6", className)}
      {...props}
    >
      <Stack gap={1}>
        <Typography variant="h2">{title}</Typography>
        {description && (
          <Typography variant="body" className="text-muted-foreground">
            {description}
          </Typography>
        )}
      </Stack>
      {viewAllPath && (
        <Link
          to={viewAllPath}
          className="flex min-h-11 shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
        >
          {viewAllLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </Stack>
  )
}

export { SectionHeader }
