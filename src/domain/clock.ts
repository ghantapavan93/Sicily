/**
 * The scenario runs on a restaurant-local clock expressed as minutes since
 * midnight. Nothing in the engine reads the wall clock, so every run of the
 * demo produces the same timestamps and the same audit trail.
 */
export type Minutes = number;

export const at = (hour24: number, minute = 0): Minutes => hour24 * 60 + minute;

export function formatClock(m: Minutes): string {
  const wrapped = ((m % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

export function formatAge(ageMin: number | null): string {
  if (ageMin === null) return "no reading";
  if (ageMin <= 0) return "just now";
  if (ageMin < 60) return `${ageMin} min ago`;
  const hours = Math.floor(ageMin / 60);
  const rest = ageMin % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}
