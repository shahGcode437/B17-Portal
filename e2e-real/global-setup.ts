import { API, apiLogPath, cleanup, countP12I } from './helpers/stack'

/** Fails fast with a clear message when the local stack is not running; clears leftovers of earlier runs. */
export default async function globalSetup() {
  apiLogPath()
  const ready = await fetch(`${API}/health/ready`).catch(() => null)
  if (!ready || !ready.ok) throw new Error(`The API is not ready at ${API}/health/ready - start PostgreSQL and the API first.`)
  const leftovers = countP12I()
  if (Object.values(leftovers).some((n) => n > 0)) {
    console.log('[real-stack] removing leftovers of an earlier run:', JSON.stringify(leftovers))
    cleanup()
  }
}
