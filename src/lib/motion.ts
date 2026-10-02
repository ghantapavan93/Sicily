/**
 * Motion tokens. Eases for things the system reveals on its own; springs for
 * things a person drives. Nothing here loops: movement marks a state change.
 */
export const EASE = {
  outQuart: [0.16, 1, 0.3, 1],
  outCubic: [0.33, 1, 0.68, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const DUR = {
  fast: 0.16,
  base: 0.26,
  slow: 0.45,
  reveal: 0.8,
} as const;

export const SPRING = {
  snappy: { type: "spring", stiffness: 320, damping: 30 },
  gentle: { type: "spring", stiffness: 120, damping: 20 },
} as const;

/** Standard entrance for a panel or row. */
export const rise = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: DUR.base, ease: EASE.outQuart },
} as const;
