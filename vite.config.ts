import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

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

/**
 * Phase 9J — emits `sitemap.xml` and the robots.txt `Sitemap:` line, but ONLY when a production
 * URL is configured (`VITE_SITE_URL`): a sitemap needs absolute URLs and no domain is hard-coded.
 * It lists the stable, public, top-level routes only (keep in step with the indexable entries of
 * `src/seo/routeSeo.ts`); individual businesses / providers / properties / news come from demo
 * data today, so a per-entity sitemap is deferred to the backend. No `lastmod` is invented.
 */
const SITEMAP_PATHS = ['/', '/services', '/directory', '/food', '/education', '/property', '/news']

function sitemapPlugin(siteUrl: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'b17-sitemap',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const base = siteUrl.trim().replace(/\/+$/, '')
      if (!base) return
      const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')
      fs.writeFileSync(
        path.join(outDir, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
      )
      fs.appendFileSync(path.join(outDir, 'robots.txt'), `\nSitemap: ${base}/sitemap.xml\n`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), serviceWorkerPlugin(), sitemapPlugin(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL ?? '')],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
}))
