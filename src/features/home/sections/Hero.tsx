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

const suggestions = ["Electrician", "Solar", "Physics tutor", "House for rent"]

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
      {/* Layered atmosphere (VR2): darken the photo for text contrast, then a brand glow field above it. */}
      <div className="absolute inset-0 bg-background/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/35 to-background/70" />
      <div className="glow-field absolute inset-x-0 top-0 h-2/3" aria-hidden="true" />
      <Container className="relative py-20 sm:py-28">
        <motion.div {...fadeUp} className="mx-auto max-w-3xl text-center">
          <Stack align="center" gap={2} className="mb-5">
            <Stack
              direction="row"
              align="center"
              gap={1}
              className="glass-2 rounded-full px-3 py-1 text-xs font-medium text-primary"
            >
              <MapPin className="size-3.5" aria-hidden="true" />
              B-17, Islamabad
            </Stack>
          </Stack>
          <Typography variant="display" className="text-balance">
            {site.name}
          </Typography>
          <Typography variant="body-lg" className="mx-auto mt-4 max-w-xl text-balance text-foreground/80">
            {site.tagline}
          </Typography>

          {/* The search sits in an elevated glass well so it reads as the page's primary action. */}
          <div className="glass-3 mx-auto mt-8 max-w-2xl rounded-2xl p-3 sm:p-4">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={runSearch}
              placeholder={site.searchPrompt}
              size="hero"
            />
            <Stack direction="row" wrap justify="center" gap={2} className="mt-3">
              <Typography variant="caption" className="mr-1 self-center">
                Try:
              </Typography>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => runSearch(s)}
                  className="glass-2 relative rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {s}
                </button>
              ))}
            </Stack>
          </div>
        </motion.div>
      </Container>
    </section>
  )
}

export { Hero }
