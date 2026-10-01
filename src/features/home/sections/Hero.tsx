import { useState } from "react"
import { MapPin } from "lucide-react"
import { motion } from "motion/react"
import { useNavigate } from "react-router-dom"
import { Container } from "@/components/foundation/Container"
import { Stack } from "@/components/foundation/Stack"
import { Typography } from "@/components/foundation/Typography"
import { SearchBar } from "@/components/inputs/SearchBar"
import { site } from "@/data/site"
import { routes } from "@/config/routes"
import { fadeUp } from "@/lib/motion"

const suggestions = ["Electrician", "Solar installer", "Physics tutor", "House for rent"]

/** Search-first hero (UI/UX Spec §7.1) — the dominant interaction on Home. */
function Hero() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")

  function runSearch(value: string) {
    // Keep the visible input in sync with what's actually being searched —
    // a quick-suggestion click sets the term here too, not just the URL, so
    // the box reflects the selection instead of appearing to ignore the click.
    setQuery(value)
    const params = value.trim() ? `?q=${encodeURIComponent(value.trim())}` : ""
    navigate(`${routes.search}${params}`)
  }

  return (
    <section className="relative overflow-hidden border-b border-border">
      <img
        src="/images/hero/hero-b17-demo-01.jpg"
        alt=""
        aria-hidden="true"
        loading="eager"
        className="absolute inset-0 h-full w-full object-cover object-[center_60%]"
      />
      <div className="absolute inset-0 bg-background/35" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/25 to-background/55" />
      <Container className="relative py-16 sm:py-24">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <Stack align="center" gap={2} className="mb-4">
            <Stack
              direction="row"
              align="center"
              gap={1}
              className="rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-subtle"
            >
              <MapPin className="size-3.5" aria-hidden="true" />
              B-17, Islamabad
            </Stack>
          </Stack>
          <Typography variant="display">{site.name}</Typography>
          <Typography variant="body-lg" className="mt-3 text-muted-foreground">
            {site.tagline}
          </Typography>

          <div className="mt-8">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={runSearch}
              placeholder={site.searchPrompt}
              size="hero"
            />
          </div>

          <Stack direction="row" wrap justify="center" gap={2} className="mt-4">
            <Typography variant="caption" className="mr-1 self-center">
              Try:
            </Typography>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => runSearch(s)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {s}
              </button>
            ))}
          </Stack>
        </motion.div>
      </Container>
    </section>
  )
}

export { Hero }
