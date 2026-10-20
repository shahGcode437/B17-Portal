import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// findBy* / waitFor poll (and return as soon as the condition holds), so a generous ceiling costs nothing when the
// machine is idle. The 1000 ms default is too tight for the first lazy render of a page under a loaded full-suite
// run (several jsdom workers on one CPU): that produced intermittent "Unable to find ..." failures with no logic race.
configure({ asyncUtilTimeout: 5000 })

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

// jsdom has no IntersectionObserver (scroll-reveal / in-view animations use it). Nothing is ever "in view" here.
if (!('IntersectionObserver' in window)) {
  class NoopIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', { writable: true, value: NoopIntersectionObserver })
}
