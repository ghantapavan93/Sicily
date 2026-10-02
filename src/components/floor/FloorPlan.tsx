"use client";

import { AnimatePresence, motion } from "framer-motion";
import { formatClock } from "@/domain/clock";
import { HOUSE } from "@/domain/venue";
import type { FloorState } from "@/twin/floor";

/*
 * Sicily from above. Five sections of four tables, the kitchen pass, the bar
 * and the door. A section tints when the person serving it is over the
 * ceiling; a section with nobody of its own is hatched and says who split
 * it. Walk-ins who give up leave by the door.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  tables: [number, number][];
  label: [number, number];
  avatar: [number, number];
  dashed?: boolean;
}

const BOXES: Record<number, Box> = {
  1: { x: 16, y: 52, w: 128, h: 248, tables: [[46, 88], [46, 146], [46, 204], [46, 262]], label: [26, 70], avatar: [118, 76] },
  2: { x: 160, y: 52, w: 150, h: 140, tables: [[180, 96], [246, 96], [180, 148], [246, 148]], label: [170, 70], avatar: [284, 76] },
  3: { x: 326, y: 52, w: 150, h: 140, tables: [[346, 96], [412, 96], [346, 148], [412, 148]], label: [336, 70], avatar: [450, 76] },
  4: { x: 160, y: 208, w: 316, h: 92, tables: [[182, 246], [256, 246], [330, 246], [404, 246]], label: [170, 226], avatar: [450, 232], dashed: true },
  5: { x: 492, y: 52, w: 132, h: 248, tables: [[508, 88], [508, 146], [508, 204], [508, 262]], label: [502, 70], avatar: [566, 286] },
};

const TABLE_W = 46;
const TABLE_H = 30;

export function FloorPlan({ floor, title }: { floor: FloorState; title?: string }) {
  const loadOf = (name: string) => floor.servers.find((s) => s.name === name);

  return (
    <figure className="m-0">
      <svg viewBox="0 0 640 400" className="w-full" role="img" aria-label={`${title ?? "The floor"} at ${formatClock(floor.at)}`}>
        <defs>
          <pattern id="split-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-brass)" strokeOpacity="0.28" strokeWidth="3" />
          </pattern>
        </defs>

        <rect x={16} y={8} width={608} height={32} rx={8} fill="var(--color-ground-3)" />
        <text x={320} y={29} textAnchor="middle" fontSize="11" letterSpacing="2" fill="var(--color-ink-lo)">
          KITCHEN · PASS
        </text>
        <rect x={598} y={60} width={14} height={180} rx={4} fill="var(--color-ground-3)" />

        {floor.sections.map((sec) => {
          const b = BOXES[sec.id]!;
          const own = sec.server ? loadOf(sec.server) : undefined;
          const over = own ? own.over : sec.coveredBy.some((n) => loadOf(n)?.over);
          const filled = Math.round(sec.occupancy * b.tables.length);
          return (
            <g key={sec.id}>
              <motion.rect
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={14}
                initial={false}
                animate={{ fill: over ? "rgba(210,162,76,0.13)" : "rgba(255,255,255,0.02)", stroke: over ? "rgba(210,162,76,0.75)" : "var(--color-line)" }}
                transition={{ duration: 0.6 }}
                strokeWidth={1.5}
                strokeDasharray={b.dashed ? "6 5" : undefined}
              />
              {!sec.server && <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14} fill="url(#split-hatch)" />}
              <text x={b.label[0]} y={b.label[1]} fontSize="10" letterSpacing="1.5" fill="var(--color-ink-lo)">
                {sec.id} · {sec.name.toUpperCase()}
              </text>

              {b.tables.map(([tx, ty], i) => (
                <motion.rect
                  key={i}
                  x={tx}
                  y={ty}
                  width={sec.id === 1 || sec.id === 5 ? TABLE_W + 20 : TABLE_W}
                  height={TABLE_H}
                  rx={7}
                  initial={false}
                  animate={{ fillOpacity: i < filled ? 0.6 : 0.08 }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  fill="var(--color-ink-mid)"
                  stroke="var(--color-line)"
                />
              ))}

              {sec.server ? (
                <g>
                  <circle cx={b.avatar[0]} cy={b.avatar[1]} r={13} fill="var(--color-ground-0)" stroke={own?.added ? "var(--color-brass-ink)" : over ? "var(--color-brass)" : "var(--color-ink-lo)"} strokeWidth={own?.added ? 2.5 : 1.5} />
                  <text x={b.avatar[0]} y={b.avatar[1] + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--color-ink-hi)">
                    {sec.server[0]}
                  </text>
                  <text x={b.avatar[0]} y={sec.id === 5 ? b.avatar[1] - 19 : b.avatar[1] + 28} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill={over ? "var(--color-brass-ink)" : "var(--color-ink-mid)"}>
                    {own ? own.load.toFixed(1) : ""}
                  </text>
                </g>
              ) : (
                <text x={b.x + b.w / 2} y={b.y + b.h - 10} textAnchor="middle" fontSize="11" fill="var(--color-brass-ink)">
                  {sec.coveredBy.length ? `Split: ${sec.coveredBy.join(" + ")}` : "Nobody"}
                </text>
              )}
            </g>
          );
        })}

        <rect x={30} y={326} width={92} height={22} rx={6} fill="var(--color-ground-3)" />
        <text x={76} y={341} textAnchor="middle" fontSize="10" letterSpacing="1.5" fill="var(--color-ink-lo)">
          HOST
        </text>
        <line x1={250} x2={390} y1={396} y2={396} stroke="var(--color-ink-lo)" strokeWidth={3} strokeLinecap="round" />
        <text x={320} y={386} textAnchor="middle" fontSize="10" letterSpacing="1.5" fill="var(--color-ink-lo)">
          DOOR
        </text>

        <AnimatePresence>
          {Array.from({ length: Math.min(6, floor.leftNow) }, (_, i) => (
            <motion.circle
              key={`${floor.at}-${i}`}
              r={4}
              fill="var(--color-brass-ink)"
              initial={{ cx: 290 + i * 12, cy: 352, opacity: 1 }}
              animate={{ cx: 290 + i * 12 + (i % 2 ? 10 : -10), cy: 412, opacity: 0 }}
              transition={{ duration: 1.4, delay: 0.3 + i * 0.15, ease: "easeIn" }}
            />
          ))}
        </AnimatePresence>
      </svg>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-2 text-[0.6875rem] text-ink-lo">
        <span>Numbers are covers an hour per server. Ceiling {HOUSE.loadCeiling}.</span>
        <span>{floor.left ? `${floor.left} walk-ins have left so far` : "Nobody has walked out"}</span>
      </figcaption>
    </figure>
  );
}
