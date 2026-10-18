// Phase 12C: MUST stay the first import. It moves a one-time e-mail token out of the URL fragment
// (into memory, then history.replaceState) before any other module — the router, App, PWA code —
// is evaluated. See src/lib/fragmentBootstrap.ts.
import './lib/fragmentBootstrap'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initInstallCapture } from './pwa/install'
import { registerServiceWorker } from './pwa/serviceWorker'

// Phase 9G: capture the install event early (it can fire before React mounts) and register the worker (production only).
initInstallCapture()
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
