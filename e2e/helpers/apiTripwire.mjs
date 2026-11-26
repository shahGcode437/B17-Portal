/**
 * The mocked E2E lane's stand-in for "the API" (see `apiIsolation.ts`). The preview server's `/api` proxy
 * points here and nowhere else. A request arriving here got PAST the browser mock, so it is recorded and
 * refused: this server never answers an API request successfully. `global-teardown.ts` fails the run if
 * anything was recorded. Only the method and the path are kept (no query, body, header or cookie).
 *
 * Usage: node e2e/helpers/apiTripwire.mjs <port>
 */
import http from 'node:http'

const HEADER = 'x-b17-e2e-tripwire'
const ESCAPES_PATH = '/__tripwire/escapes'
const PROBE_PREFIX = '/api/__isolation-probe'

const port = Number(process.argv[2])
const escapes = []

function reply(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', [HEADER]: '1' })
  response.end(JSON.stringify(body))
}

http
  .createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://tripwire.invalid').pathname
    if (path === ESCAPES_PATH) return reply(response, 200, { escapes })
    if (!path.startsWith(PROBE_PREFIX)) {
      const entry = `${request.method} ${path}`
      escapes.push(entry)
      console.error(`[api-tripwire] a request escaped the mock layer: ${entry}`)
    }
    const message = 'No backend exists in the mocked E2E lane: this request escaped the mock layer.'
    reply(response, 502, { error: { code: 'e2e_unmocked_api', message, details: [], requestId: 'e2e-tripwire' } })
  })
  .listen(port, '127.0.0.1')
