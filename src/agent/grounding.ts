import type { GroundingReport } from "./protocol";

/**
 * After Savy answers, every figure in the answer is looked up in what the
 * tools returned during that run. A figure that appears nowhere in the tool
 * results is reported to the person, next to the answer.
 *
 * This is a check, not a filter: it does not rewrite the answer. It makes an
 * invented number visible instead of trusting that there are none.
 */

const CITATION = /\[((?:evt|mem)_[a-z0-9_]+|DEC-[A-Z0-9]+(?:-[A-Z0-9]+)*|RCT-\d{3}|[A-Z]{2,6}-\d{2}|tonight)\]/g;
const CLOCK = /\b\d{1,2}:\d{2}\b/g;
const FIGURE = /\$?\d[\d,]*(?:\.\d+)?(?:k\b|%)?/g;
/** Every record id a tool can return, matched whole so "[DEC-S]" is not backed by "DEC-STAFF". */
const RECORD_ID = /\b(?:evt|mem)_[a-z0-9_]+\b|\bDEC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b|\bRCT-\d{3}\b|\b[A-Z]{2,6}-\d{2}\b/g;

const stripSeparators = (text: string) => text.replace(/(\d),(?=\d{3})/g, "$1");

/** "$2,499" → "2499", "24.4%" → "24.4", "$2.5k" → "2500". */
const bare = (token: string) => {
  const plain = token.replace(/[$,%]/g, "");
  return plain.endsWith("k") ? String(Number(plain.slice(0, -1)) * 1000) : plain;
};

/** "19:00" → "7:00", so an answer in 24-hour time is matched against records written in 12-hour time. */
function twelveHour(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h > 12 ? `${h - 12}:${String(m).padStart(2, "0")}` : time;
}

/** Whole times only: "7:00" is not backed by "17:00". */
const timeIn = (time: string, text: string) => new RegExp(`(^|[^\\d])${time}(?!\\d)`).test(text);

/** Small whole numbers ("4 servers", "3 records") are counts people say freely; they are not checked. */
function worthChecking(token: string): boolean {
  if (/[$%.k]/.test(token)) return true;
  return Number(bare(token)) >= 10;
}

/** Every number a text could back: as written, and rounded the ways an answer would round it. */
function figuresIn(text: string): Set<string> {
  const known = new Set<string>();
  for (const match of stripSeparators(text).match(FIGURE) ?? []) {
    const value = bare(match);
    known.add(value);
    const n = Number(value);
    if (Number.isFinite(n)) {
      known.add(String(Math.round(n)));
      known.add(n.toFixed(1));
      known.add(String(Number(n.toFixed(1))));
    }
  }
  return known;
}

/** Ids carry digits (evt_fr_012, VP-20931) that must never count as figures a tool "returned". */
const withoutIds = (text: string) => text.replace(/\b(?:evt|mem)_[a-z0-9_]+\b/g, " ").replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, " ");

export function checkGrounding(answer: string, toolResults: readonly string[], question = ""): GroundingReport {
  // Only the tools are evidence. The question is kept apart: a number the person typed can be repeated
  // back, but it is reported as theirs, never as confirmed.
  const corpus = toolResults.join("\n");
  const known = figuresIn(withoutIds(corpus));
  const asked = figuresIn(withoutIds(question));
  const ids = new Set(corpus.match(RECORD_ID) ?? []);

  const citations = [...new Set([...answer.matchAll(CITATION)].map((m) => m[1] ?? ""))].filter(Boolean);
  const unknownCitations = citations.filter((id) => (id === "tonight" ? !corpus.includes(id) : !ids.has(id)));

  // Ids and clock times are checked on their own terms, then removed so their digits are not re-read as figures.
  // Record ids (VP-20931, PO-1002-01, evt_fr_021) carry digits that are not figures.
  let prose = answer
    .replace(CITATION, " ")
    .replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, " ")
    .replace(/\b(?:evt|mem)_[a-z0-9_]+\b/g, " ");
  const ungrounded: string[] = [];
  const fromQuestion: string[] = [];
  let figures = 0;

  for (const time of prose.match(CLOCK) ?? []) {
    figures++;
    if (timeIn(time, corpus) || timeIn(twelveHour(time), corpus)) continue;
    if (timeIn(time, question)) fromQuestion.push(time);
    else ungrounded.push(time);
  }
  prose = prose.replace(CLOCK, " ");

  for (const token of stripSeparators(prose).match(FIGURE) ?? []) {
    if (!worthChecking(token)) continue;
    figures++;
    const value = bare(token);
    const n = Number(value);
    const backedBy = (set: Set<string>) => set.has(value) || (Number.isFinite(n) && (set.has(n.toFixed(1)) || set.has(String(n))));
    if (backedBy(known)) continue;
    if (backedBy(asked)) fromQuestion.push(token);
    else ungrounded.push(token);
  }

  return { figures, ungrounded: [...new Set(ungrounded)], citations, unknownCitations, fromQuestion: [...new Set(fromQuestion)] };
}
