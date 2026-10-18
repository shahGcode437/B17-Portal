import { captureFragmentToken } from "./fragmentToken"

/**
 * Import-time boundary for one-time e-mail tokens (Phase 12C). `main.tsx` imports this module FIRST:
 * ES module imports are evaluated in order and before the importing module's own body, so anything
 * imported after it (the router, which reads `window.location` when it is created; the PWA code;
 * `App`) sees a URL whose `#token=…` fragment has already been moved into memory and removed.
 * Deliberately tiny: it must import nothing that has side effects of its own.
 */
captureFragmentToken()
