import { useForm } from "react-hook-form"
import type { Provider } from "@/types/provider"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { zodResolver } from "@/lib/zodResolver"
import { serviceRequestSchema, type ServiceRequestValues } from "@/features/services/serviceRequestSchema"

interface ServiceRequestFormProps {
  provider: Provider
  requesterName: string
  onSubmit: (values: ServiceRequestValues) => void
  onCancel: () => void
}

const selectClassName = cn(
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
  "md:text-sm dark:bg-input/30"
)

const todayISO = new Date().toISOString().slice(0, 10)

/** Short Service Request form (UI/UX Spec §12) — used inside RequestServiceDialog. */
function ServiceRequestForm({ provider, requesterName, onSubmit, onCancel }: ServiceRequestFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceRequestValues>({
    resolver: zodResolver(serviceRequestSchema),
    defaultValues: {
      service: provider.tags[0] ?? provider.categoryLabel,
      details: "",
      area: "",
      preferredDate: "",
      preferredTime: "",
      notes: "",
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Stack gap={4}>
        <Typography variant="caption" className="text-muted-foreground">
          Requesting as <span className="font-medium text-foreground">{requesterName}</span>
        </Typography>

        <Stack gap={2}>
          <Label htmlFor="request-service">Service</Label>
          <select
            id="request-service"
            className={selectClassName}
            aria-invalid={!!errors.service}
            aria-describedby={errors.service ? "request-service-error" : undefined}
            {...register("service")}
          >
            {provider.tags.map((tag) => (
              <option key={tag} value={tag} className="capitalize">
                {tag}
              </option>
            ))}
          </select>
          {errors.service && (
            <Typography id="request-service-error" variant="caption" className="text-destructive" role="alert">
              {errors.service.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="request-details">What do you need?</Label>
          <Textarea
            id="request-details"
            placeholder="e.g. Install a 5kW solar system on a single-storey rooftop."
            rows={3}
            aria-invalid={!!errors.details}
            aria-describedby={errors.details ? "request-details-error" : undefined}
            {...register("details")}
          />
          {errors.details && (
            <Typography id="request-details-error" variant="caption" className="text-destructive" role="alert">
              {errors.details.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="request-area">Area / Location</Label>
          <Input
            id="request-area"
            placeholder="e.g. B-17, Block C"
            aria-invalid={!!errors.area}
            aria-describedby={errors.area ? "request-area-error" : undefined}
            {...register("area")}
          />
          {errors.area && (
            <Typography id="request-area-error" variant="caption" className="text-destructive" role="alert">
              {errors.area.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={3} className="flex-col sm:flex-row">
          <Stack gap={2} className="flex-1">
            <Label htmlFor="request-date">Preferred Date</Label>
            <Input
              id="request-date"
              type="date"
              min={todayISO}
              aria-invalid={!!errors.preferredDate}
              aria-describedby={errors.preferredDate ? "request-date-error" : undefined}
              {...register("preferredDate")}
            />
            {errors.preferredDate && (
              <Typography id="request-date-error" variant="caption" className="text-destructive" role="alert">
                {errors.preferredDate.message}
              </Typography>
            )}
          </Stack>

          <Stack gap={2} className="flex-1">
            <Label htmlFor="request-time">Preferred Time (optional)</Label>
            <Input id="request-time" type="time" {...register("preferredTime")} />
          </Stack>
        </Stack>

        <Stack gap={2}>
          <Label htmlFor="request-notes">Additional Details (optional)</Label>
          <Textarea id="request-notes" placeholder="Anything else the provider should know?" rows={2} {...register("notes")} />
          {errors.notes && (
            <Typography variant="caption" className="text-destructive" role="alert">
              {errors.notes.message}
            </Typography>
          )}
        </Stack>

        <Stack gap={2} className="flex-col-reverse sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            Submit Request
          </Button>
        </Stack>
      </Stack>
    </form>
  )
}

export { ServiceRequestForm }
