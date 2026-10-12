import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * Unit + component tests (Phase 9M). Reuses the app's Vite config (the `@` alias, React plugin,
 * Tailwind) so tests resolve modules exactly like the app does. The build-only plugins in
 * vite.config.ts (`apply: 'build'`) are inert here. E2E tests live in `e2e/` and run under
 * Playwright, not Vitest.
 */
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      // jsdom + user-event on a cold Windows/OneDrive disk can exceed the 5 s default; this is headroom, not a retry.
      testTimeout: 15_000,
      restoreMocks: true,
      clearMocks: true,
    },
  })
)
