import type { CSSProperties } from "react";

/**
 * A dining room before service, seen out of focus: pendant lights and the
 * glow off a pass. Drawn in CSS so the prototype ships no photography.
 * Positions are fixed so the scene is identical on every load.
 */
const LIGHTS: { left: string; top: string; size: number; drift: number; dx: number; dy: number; low: number; high: number }[] = [
  { left: "8%", top: "22%", size: 150, drift: 19, dx: 14, dy: -6, low: 0.22, high: 0.42 },
  { left: "21%", top: "34%", size: 90, drift: 15, dx: -10, dy: 6, low: 0.3, high: 0.55 },
  { left: "34%", top: "18%", size: 120, drift: 22, dx: 8, dy: 10, low: 0.18, high: 0.36 },
  { left: "47%", top: "30%", size: 70, drift: 13, dx: -6, dy: -8, low: 0.34, high: 0.6 },
  { left: "58%", top: "16%", size: 170, drift: 24, dx: 12, dy: 6, low: 0.16, high: 0.32 },
  { left: "69%", top: "33%", size: 100, drift: 17, dx: -12, dy: -4, low: 0.28, high: 0.5 },
  { left: "81%", top: "20%", size: 130, drift: 20, dx: 10, dy: 8, low: 0.2, high: 0.4 },
  { left: "90%", top: "38%", size: 80, drift: 14, dx: -8, dy: -10, low: 0.3, high: 0.52 },
  { left: "14%", top: "58%", size: 60, drift: 16, dx: 6, dy: -6, low: 0.14, high: 0.3 },
  { left: "76%", top: "60%", size: 64, drift: 18, dx: -6, dy: 6, low: 0.14, high: 0.28 },
];

export function SceneBackdrop() {
  return (
    <div aria-hidden className="scene absolute inset-0 overflow-hidden">
      {LIGHTS.map((l, i) => (
        <span
          key={i}
          className="scene-light"
          style={
            {
              left: l.left,
              top: l.top,
              width: l.size,
              height: l.size,
              "--drift": `${l.drift}s`,
              "--dx": `${l.dx}px`,
              "--dy": `${l.dy}px`,
              "--low": l.low,
              "--high": l.high,
            } as CSSProperties
          }
        />
      ))}
      {/* The pass: a low band of warm light across the back of the room. */}
      <div className="absolute inset-x-0 bottom-[18%] h-px bg-gradient-to-r from-transparent via-brass/40 to-transparent" />
      <div className="absolute inset-x-[10%] bottom-[18%] h-40 bg-[radial-gradient(ellipse_at_50%_100%,rgba(210,150,70,0.16),transparent_70%)]" />
      <div className="scene-vignette absolute inset-0" />
      <div className="grain absolute inset-0" />
    </div>
  );
}
