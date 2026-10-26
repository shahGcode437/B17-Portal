/**
 * In development the backend's e-mail backend is `console`: NOTHING is delivered, the link is only printed
 * in the API terminal (docs/backend/AUTH_RBAC.md, "Development e-mail verification"). User-facing copy that
 * would otherwise say "we sent you an e-mail" must not say so there. This is evaluated at call time from
 * `import.meta.env.DEV`, so every production build keeps the real wording and the development text is
 * compiled out of it.
 *
 * Revisit when real e-mail delivery exists in development (Phase 13).
 */
export function isDevMail(): boolean {
  return import.meta.env.DEV
}

/** The command that prints a verification link for a local account (development only). */
export function devVerifyCommand(email: string): string {
  return `python -m app.cli.dev_verify ${email}`
}
