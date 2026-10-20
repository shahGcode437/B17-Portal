import { useNavigate } from "react-router-dom"
import { Newspaper } from "lucide-react"
import { Container } from "@/components/foundation/Container"
import { EmptyState } from "@/components/feedback/EmptyState"
import { useRequireAdminAuth } from "@/hooks/useRequireAdminAuth"
import { routes } from "@/config/routes"

/**
 * The News & Updates admin pages until the backend has a news-administration API. The public news
 * pages now read the real `GET /news`, so the old content manager - which edited a browser-local
 * list nothing public reads any more - would report a "published" article that nobody can see.
 * Rather than pretend, the page says it is not available yet.
 */
function NewsAdminSoon({ title }: { title: string }) {
  const admin = useRequireAdminAuth()
  const navigate = useNavigate()
  if (!admin) return null
  return (
    <Container className="py-16">
      <EmptyState
        headingLevel={1}
        icon={Newspaper}
        title={title}
        description="Creating, editing and publishing news and daily updates from here is coming soon. The news readers see on the site is read from the server."
        actionLabel="Back to the Dashboard"
        onAction={() => navigate(routes.adminDashboard)}
      />
    </Container>
  )
}

export { NewsAdminSoon }
