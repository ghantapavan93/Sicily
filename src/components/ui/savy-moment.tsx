import type { CSSProperties } from "react";

/**
 * The only three things Savy's spectrum may mean. See "Savy's moments" in
 * globals.css for what each looks like.
 */
export type MomentKind = "synthesis" | "transition" | "learning";

const delayOf = (ms: number | undefined) => (ms === undefined ? undefined : ({ "--savy-delay": `${ms}ms` } as CSSProperties));

/**
 * A one-shot ring over the edge of the surface it sits in. The parent must be
 * positioned. It is keyed on the moment, so a new moment replays it and a
 * re-render does not.
 */
export function SavyEdge({ kind, id, delay }: { kind: MomentKind; id: number | string; delay?: number }) {
  return (
    <>
      <span key={id} aria-hidden data-savy-moment={kind} className={`savy-${kind}`} style={delayOf(delay)} />
    </>
  );
}
