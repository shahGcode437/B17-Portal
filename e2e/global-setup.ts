import type { FullConfig } from '@playwright/test'
import { PROBE_PREFIX, TRIPWIRE_HEADER } from './helpers/apiIsolation'

/**
 * Before ANY test: prove that the server under test forwards `/api` to the tripwire. If it forwarded
 * anywhere else (a developer's running API, say), the run stops here, having sent one GET for a path that
 * no API has.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error('API isolation: no baseURL is configured, so it cannot be verified.')
  const response = await fetch(new URL(`${PROBE_PREFIX}/preflight`, baseURL))
  if (!response.headers.has(TRIPWIRE_HEADER)) {
    throw new Error(
      `API isolation: ${baseURL} does not forward /api to the E2E tripwire (answer: ${response.status}). ` +
        'Refusing to run: the mocked lane must never reach a real API.'
    )
  }
}
