/**
 * Every endpoint the shared mock (`authMock.ts` with the two fixture routers) answers, relative to
 * `/api/v1`. Anything else is UNMOCKED: refused with `501` and the test fails.
 *
 * The list exists because the routers cannot say "I do not know this path": signed out they answer `401`,
 * and signed in `404`, which looks exactly like a real refusal. Adding a handler means adding it here.
 */
const ID = '[^/]+'

const MOCKED: Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string[]> = {
  GET: [
    '/auth/me',
    '/categories',
    '/search',
    '/search/suggestions',
    `/listings/${ID}`,
    '/news',
    `/news/${ID}`,
    '/saved',
    '/requests',
    `/requests/${ID}`,
    '/users/me/leads',
    '/users/me/listings',
    `/users/me/listings/${ID}`,
    '/admin/listings',
    `/admin/listings/${ID}`,
    '/admin/categories',
    '/grocery/availability',
    '/grocery/orders',
    `/grocery/orders/${ID}`,
    '/admin/grocery/orders',
    `/admin/grocery/orders/${ID}`,
  ],
  POST: [
    '/auth/(login|register|logout|logout-all|resend-verification|verify-email|forgot-password|reset-password)',
    '/auth/oauth/google/start',
    '/listings',
    `/listings/${ID}/archive`,
    '/requests',
    `/requests/${ID}/(accept|start|complete|cancel)`,
    `/admin/listings/${ID}/(approve|reject)`,
    '/admin/categories',
    '/admin/categories/reorder',
    '/grocery/orders',
    `/grocery/orders/${ID}/cancel`,
    `/admin/grocery/orders/${ID}/(claim|release|confirm|reconfirm|reduce-amount|start-preparing|dispatch|delivery-failed|complete|cancel|issues)`,
  ],
  PUT: ['/users/me/professional-profile', `/saved/${ID}`],
  PATCH: [`/listings/${ID}`, `/admin/categories/${ID}`],
  DELETE: [`/saved/${ID}`],
}

const PATTERNS = new Map(
  Object.entries(MOCKED).map(([method, paths]) => [method, paths.map((path) => new RegExp(`^${path}$`))])
)

export function isMocked(method: string, path: string): boolean {
  return PATTERNS.get(method)?.some((pattern) => pattern.test(path)) ?? false
}
