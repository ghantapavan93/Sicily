/** Ties are broken by plain code-unit order, never by locale, so server and browser always sort alike. */
export const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Who started last among those working: the one an early out goes to. One rule, used everywhere. */
export const lastServerIn = <T extends { start: number; name: string }>(working: readonly T[]): T | undefined =>
  [...working].sort((a, b) => b.start - a.start || byText(a.name, b.name))[0];
