import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Phase 9G — emits `sw.js` from `pwa/sw.template.js` after the build. The precache list is the app
 * shell only: "/" plus the JS/CSS that dist/index.html itself references (entry + modulepreload).
 * Lazy route chunks are intentionally NOT listed, so Phase 9H code splitting is preserved. The build
 * id is a hash of that list, so the worker file changes (and browsers update it) whenever the shell does.
 */
function serviceWorkerPlugin(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  return {
    name: 'b17-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1])
      const precache = ['/', ...new Set(assets)]
      const buildId = crypto.createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 10)
      const template = fs.readFileSync(path.join(root, 'pwa/sw.template.js'), 'utf8')
      fs.writeFileSync(
        path.join(outDir, 'sw.js'),
        template.replace('__BUILD_ID__', buildId).replace('__PRECACHE_URLS__', JSON.stringify(precache))
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
