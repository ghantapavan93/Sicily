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
const FIGURE = /\$?\d[\d,]*(?:\.\d+)?%?/g;

const stripSeparators = (text: string) => text.replace(/(\d),(?=\d{3})/g, "$1");

/** "$2,499" → "2499", "24.4%" → "24.4". */
const bare = (token: string) => token.replace(/[$,%]/g, "");

/** Small whole numbers ("4 servers", "3 records") are counts people say freely; they are not checked. */
function worthChecking(token: string): boolean {
  if (/[$%.]/.test(token)) return true;
  return Number(bare(token)) >= 10;
}

/** Every number a tool result could back: as written, and rounded the ways an answer would round it. */
function figuresIn(corpus: string): Set<string> {
  const known = new Set<string>();
  for (const match of stripSeparators(corpus).match(FIGURE) ?? []) {
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
  const corpus = `${toolResults.join("\n")}\n${question}`;
  const known = figuresIn(withoutIds(corpus));

  const citations = [...new Set([...answer.matchAll(CITATION)].map((m) => m[1] ?? ""))].filter(Boolean);
  const unknownCitations = citations.filter((id) => !corpus.includes(id));

  // Ids and clock times are checked on their own terms, then removed so their digits are not re-read as figures.
  // Record ids (VP-20931, PO-1002-01, evt_fr_021) carry digits that are not figures.
  let prose = answer
    .replace(CITATION, " ")
    .replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, " ")
    .replace(/\b(?:evt|mem)_[a-z0-9_]+\b/g, " ");
  const ungrounded: string[] = [];
  let figures = 0;

  for (const time of prose.match(CLOCK) ?? []) {
    figures++;
    // Whole times only: "7:00" is not backed by "17:00".
    if (!new RegExp(`(^|[^\\d])${time}(?!\\d)`).test(corpus)) ungrounded.push(time);
  }
  prose = prose.replace(CLOCK, " ");

  for (const token of stripSeparators(prose).match(FIGURE) ?? []) {
    if (!worthChecking(token)) continue;
    figures++;
    const value = bare(token);
    const n = Number(value);
    const backed = known.has(value) || (Number.isFinite(n) && (known.has(n.toFixed(1)) || known.has(String(n))));
    if (!backed) ungrounded.push(token);
  }

  return { figures, ungrounded: [...new Set(ungrounded)], citations, unknownCitations };
}
