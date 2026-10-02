import clsx from "clsx";
import { VENUE } from "@/domain/venue";

/** Shown on every screen. The prototype never claims more than it is. */
export function Disclosure({ className }: { className?: string }) {
  return (
    <p className={clsx("text-xs leading-relaxed text-ink-lo", className)}>
      Independent product exploration for OPSAVOR. Synthetic restaurant data. No real {VENUE.name} or OPSAVOR systems
      are connected.
    </p>
  );
}
