import { ESCAPES_PATH, TRIPWIRE_ORIGIN } from './helpers/apiIsolation'

/**
 * After ALL tests: fail the run if any API request reached the tripwire. This catches what the per-test
 * browser guard cannot see (`route.continue()`, an `APIRequestContext` call, a service-worker fetch, a
 * request sent as a test was ending). It fails closed: an unreachable tripwire is a failure too.
 */
export default async function globalTeardown(): Promise<void> {
  const response = await fetch(`${TRIPWIRE_ORIGIN}${ESCAPES_PATH}`)
  const { escapes } = (await response.json()) as { escapes: string[] }
  if (escapes.length > 0) {
    throw new Error(
      `API isolation: ${escapes.length} request(s) escaped the mock layer and were refused by the tripwire:\n  ` +
        escapes.join('\n  ')
    )
  }
}
