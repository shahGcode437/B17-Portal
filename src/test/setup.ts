import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// RTL's automatic cleanup needs test globals, which this project does not enable.
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

// jsdom has no matchMedia; the PWA install code reads `display-mode` through it. Default: nothing matches.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// jsdom lacks scrollIntoView, which Radix / our focus helpers may call.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
