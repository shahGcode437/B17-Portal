/**
 * Centralized motion tokens (UI/UX Spec §20, Master Spec §12).
 * Durations are in seconds for the `motion` library. Keep every
 * animated component on these values instead of ad-hoc durations.
 */

export const duration = {
  press: 0.1, // 80-150ms
  hover: 0.16, // 120-200ms
  dropdown: 0.18, // 120-220ms
  modal: 0.24, // 180-300ms
  toast: 0.22, // 180-280ms
  route: 0.28, // 200-350ms
  detail: 0.35, // 250-450ms
} as const

export const stagger = {
  item: 0.05, // 30-70ms interval
} as const

export const easing = {
  standard: [0.22, 1, 0.36, 1], // ease-out, natural deceleration
  enter: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
} as const

/** Fade + small upward entrance — hero, section reveals */
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: duration.route, ease: easing.standard },
}

/** Card lift on hover/press */
export const cardHover = {
  whileHover: { y: -2, scale: 1.01 },
  whileTap: { scale: 0.99 },
  transition: { duration: duration.hover, ease: easing.standard },
}

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: stagger.item },
  },
}
