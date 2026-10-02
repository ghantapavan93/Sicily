import type { AgentEvent } from "./protocol";
import { runTool, type AgentContext } from "./tools";

/**
 * The planner used when no model is connected. It is not a language model
 * and does not pretend to be one: it matches the question to an intent,
 * calls the same tools the model would call, and words the answer only from
 * what they return. It exists so the tool layer, the trace, the grounding
 * check and the approval gate all run for real without a key.
 */

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (typeof v === "object" && v !== null ? (v as Loose) : {});
const arr = (v: unknown): Loose[] => (Array.isArray(v) ? v.map(obj) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));
/** Whole words and phrases only, so "po" never matches inside "proposal" and "do it" not inside "do items". */
const hasWord = (q: string, ...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(q));

export type Intent =
  | "propose"
  | "boundary"
  | "afford"
  | "what_if"
  | "do_nothing"
  | "item"
  | "changed"
  | "can_wait"
  | "hidden"
  | "explain"
  | "invoice"
  | "order"
  | "cash"
  | "confidence"
  | "unknown"
  | "memory"
  | "history"
  | "receipts"
  | "staffing"
  | "help"
  | "attention";

/** Questions that only make sense once Savy has formed tonight's decisions. */
const WAITS_ON_DECISIONS = new Set<Intent>(["propose", "afford", "do_nothing", "can_wait", "explain", "order", "cash", "confidence", "staffing"]);

const ITEM_WORDS: [string, string[]][] = [
  ["burrata", ["burrata"]],
  ["branzino", ["branzino", "fish"]],
  ["greens", ["greens", "salad", "lettuce"]],
];
const itemIn = (q: string) => ITEM_WORDS.find(([, words]) => has(q, ...words))?.[0] ?? null;

/** First match wins, so the order runs from the most specific wording to the least. */
export function intentOf(question: string): Intent {
  const q = question.toLowerCase();
  if (has(q, "can you send", "can you text", "can you order", "order it yourself", "yourself", "on your own", "automatically", "who approves", "who can approve")) return "boundary";
  if (hasWord(q, "approve", "go ahead", "add the server", "yes, add", "do it", "submit the order", "send the order", "ask the manager", "check the walk-in", "check stock", "re-check", "recheck", "refresh sales")) return "propose";
  if (has(q, "afford")) return "afford";
  if (has(q, "do nothing", "if i don't", "if nothing", "ignore it", "no change", "doing nothing")) return "do_nothing";
  if (has(q, "what if", "what happens if", "suppose", "drop by", "fall by", "goes down", "says no", "cancelled", "canceled")) return "what_if";
  if (has(q, "hide", "hidden", "filtered", "suppress", "noise")) return "hidden";
  if (has(q, "can wait", "monday", "later", "prioriti", "what's urgent", "what is urgent")) return "can_wait";
  if (has(q, "like i'm on the floor", "for the gm", "gm version", "tell the manager", "engineer", "explain it", "explain this")) return "explain";
  if (has(q, "receipt", "turn out", "how did tonight", "how did it go", "what happened tonight")) return "receipts";
  if (has(q, "changed", "since this morning", "since noon", "timeline", "so far", "what happened")) return "changed";
  if (has(q, "learn", "memory", "remember", "pattern", "dna")) return "memory";
  if (has(q, "last 30", "history", "shadow", "been right", "track record", "trust")) return "history";
  if (has(q, "how sure", "confident", "confidence", "certain")) return "confidence";
  if (has(q, "don't you know", "do not know", "dont you know", "missing", "unknown", "can't you see")) return "unknown";
  if (itemIn(q) || has(q, "inventory", "run out", "86", "stock")) return "item";
  if (has(q, "invoice", "price", "produce", "vendor", "supplier")) return "invoice";
  if (has(q, "order", "purchas", " po", "tomorrow")) return "order";
  if (has(q, "cash", "money", "spend", "bank")) return "cash";
  if (has(q, "labor", "server", "staff", "coverage", "floor", "urgent")) return "staffing";
  if (/^(hi|hello|hey)\b/.test(q) || has(q, "what can you", "help", "who are you", "what do you do")) return "help";
  return "attention";
}

export interface RulesOutcome {
  text: string;
  toolResults: string[];
}

export async function* answerByRules(
  question: string,
  ctx: AgentContext,
  pace: (kind: "tool" | "text") => Promise<void>,
): AsyncGenerator<AgentEvent, RulesOutcome> {
  const q = question.toLowerCase();
  const toolResults: string[] = [];
  let seq = 0;

  async function* call(name: string, input: Loose = {}): AsyncGenerator<AgentEvent, Loose> {
    const id = `rule_${++seq}`;
    const started = Date.now();
    yield { type: "tool.called", id, name, input };
    await pace("tool");
    const run = runTool(ctx, name, input);
    toolResults.push(run.json);
    yield { type: "tool.returned", id, summary: run.summary, ms: Date.now() - started, isError: run.isError };
    return obj(run.result);
  }

  const lines: string[] = [];
  const say = (line: string) => {
    if (line.trim()) lines.push(line.trim().replace(/\s+/g, " "));
  };

  const decisions = (l: Loose) => arr(l.decisions);
  const isOpen = (d: Loose) => d.status !== "approved" && d.status !== "rejected" && d.status !== "resolved";
  const firstNeeding = (l: Loose) => decisions(l).find((d) => str(d.lane) !== "can wait" && isOpen(d));
  const cite = (d: Loose) => `[${str(d.id)}]`;
  const evidenceCites = (d: Loose) =>
    arr(d.evidence)
      .slice(0, 3)
      .map((e) => `[${str(e.id)}]`)
      .join(" ");

  /** A decision in three lines: what, why, and what Savy recommends or needs. */
  const sayDecision = (d: Loose) => {
    say(`${str(d.headline)} ${cite(d)}`);
    say(`${str(d.why_it_matters)} ${evidenceCites(d)}`);
    const rec = obj(d.recommendation);
    if (rec.action) say(`${d.approvable === true ? "I recommend" : "Next step"}: ${str(rec.action)}. ${str(rec.detail)}`);
    const unknown = strs(d.still_unknown)[0];
    if (unknown) say(`Not known: ${unknown}`);
  };

  async function* decisionById(id: string): AsyncGenerator<AgentEvent, Loose | null> {
    const l = yield* call("list_decisions");
    return decisions(l).some((d) => str(d.id) === id) ? yield* call("get_decision", { id }) : null;
  }

  // While Savy is still reading, there are no decisions to describe or price yet. Say that instead of "+$0".
  const asked = intentOf(question);
  const reading = ctx.state.phase === "arriving" || ctx.state.phase === "processing";
  const intent = reading && WAITS_ON_DECISIONS.has(asked) ? "still_reading" : asked;
  switch (intent) {
    case "still_reading": {
      const p = yield* call("get_pulse");
      say(`I'm still reading tonight's events, so nothing is decided yet. ${str(p.signals_arrived)} signals have arrived as of ${str(p.as_of)}.`);
      say("Ask again when the read finishes and I'll answer from the decisions.");
      break;
    }

    case "propose": {
      const l = yield* call("list_decisions");
      const item = itemIn(q);
      let input: Loose;
      if (has(q, "ask the manager", "check the walk-in", "check stock", "count")) {
        // The count to ask for is the one a decision is waiting on: its item, and whether it is the line or the walk-in.
        const waiting = arr(l.waiting_on_counts);
        const wanted = waiting.find((w) => !item || str(w.item) === item) ?? waiting[0];
        input = { action: "ask_manager", item: str(wanted?.item ?? item ?? "burrata"), place: str(wanted?.place ?? "backup"), reason: "The owner asked for the count Savy is missing." };
      } else if (has(q, "re-check", "recheck", "refresh sales")) {
        input = { action: "recheck_pos", reason: "The owner asked for current sales." };
      } else if (has(q, "submit", "send the order")) {
        input = { action: "submit_po", reason: "The owner asked to submit the approved order." };
      } else {
        const id = hasWord(q, "order", "po", "purchase order")
          ? "DEC-PO"
          : hasWord(q, "invoice")
            ? "DEC-INVOICE"
            : hasWord(q, "salad", "greens", "credit")
              ? "DEC-GREENS-SHORT"
              : hasWord(q, "cash", "defer")
                ? "DEC-CASH"
                : "DEC-STAFF";
        // No guessing: if the decision asked for doesn't exist tonight, say so rather than approve something else.
        input = { action: "approve", decision: id, reason: "The owner asked to approve it." };
      }
      const p = yield* call("propose_action", input);
      if (str(p.status) === "waiting_for_person") say("I've put it in front of you. Nothing happens until you press it.");
      else if (p.error) say("There's no decision like that open tonight, so there's nothing to approve.");
      else say(`I can't put that forward. ${str(p.why)}`);
      break;
    }

    case "boundary": {
      const l = yield* call("list_decisions");
      const top = firstNeeding(l) ?? decisions(l)[0];
      if (!top) {
        say("Nothing is open tonight. Either way, I can read, compute and prepare. I can't send, order, publish or pay.");
        break;
      }
      const d = yield* call("get_decision", { id: str(top.id) });
      const perms = obj(d.permissions);
      say(`No. On ${str(d.title).toLowerCase()} ${cite(d)} I can: ${strs(perms.can).join(", ").toLowerCase()}.`);
      say(`I can't: ${strs(perms.cannot).join(", ").toLowerCase()}. ${str(obj(d.authority).why)}`);
      say("No decision lets me act outside the restaurant: external_action_allowed is false on every one.");
      break;
    }

    case "afford": {
      const staff = yield* decisionById("DEC-STAFF");
      const cash = yield* call("get_surface", { surface: "cash" });
      if (staff) {
        const effects = arr(staff.effects);
        const wages = effects.find((e) => str(e.label).startsWith("Wages"));
        const labor = effects.find((e) => str(e.label) === "Labor");
        if (wages && labor) {
          const under = Number.parseFloat(str(labor.to)) <= 30;
          say(`${under ? "Yes" : "It's tight"}. Wages go from ${str(wages.from)} to ${str(wages.to)}, and labor from ${str(labor.from)} to ${str(labor.to)} against your 30% goal. ${cite(staff)}`);
        } else say(`${str(staff.headline)} ${cite(staff)}`);
      }
      say(`All of tonight's proposed decisions change projected weekly cash by ${str(cash.tonights_proposed_decisions_change_cash_by)}, against ${str(cash.weekly_cash_before_tonight)} before tonight and your ${str(cash.owner_floor)} floor.`);
      break;
    }

    case "do_nothing": {
      const sim = yield* call("simulate_night");
      if (sim.available !== true) {
        say(str(sim.why));
        break;
      }
      const a = obj(sim.no_change);
      const b = obj(sim.savy_plan);
      say(
        `If nothing changes: peak ${str(a.peak_covers_per_server)} covers per server, tickets ${str(a.worst_ticket_minutes)} minutes at worst, ${str(a.walk_ins_lost)} walk-ins lost${strs(a.sold_out).length ? `, ${strs(a.sold_out).join(" and ")}` : ""}. Sales ${str(a.sales)}.`,
      );
      say(`With my plan (${strs(b.actions).join("; ").toLowerCase()}): peak ${str(b.peak_covers_per_server)}, tickets ${str(b.worst_ticket_minutes)} minutes, sales ${str(b.sales)}, wages ${str(b.wages)}.`);
      say(str(sim.caveat));
      break;
    }

    case "what_if": {
      const input: Loose = {};
      const n = /(\d{1,3})/.exec(q);
      if (has(q, "says no", "declines", "can't come", "on-call", "on call")) input.on_call_declines = true;
      else if (has(q, "concert", "event") && has(q, "cancel")) input.event_cancelled = true;
      else if (has(q, "pos", "sales")) input.fault = "pos_delayed";
      else if (has(q, "disagree", "host")) input.fault = "reservations_disagree";
      else if (has(q, "vendor", "times out", "timeout")) input.fault = "vendor_timeout";
      else if (has(q, "invoice") && has(q, "twice", "duplicate")) input.fault = "invoice_duplicated";
      else if (itemIn(q) && n) {
        input.backup_item = itemIn(q);
        input.backup_units = Number(n[1]);
      } else if (n) {
        const staffing = yield* call("get_surface", { surface: "staffing" });
        const booked = Number(staffing.booked_covers ?? 0);
        const delta = Number(n[1]);
        input.covers = has(q, "drop", "fall", "lose", "cancel", "fewer", "down") ? booked - delta : has(q, "jump", "more", "add", "up") ? booked + delta : delta;
      } else input.fault = "pos_delayed";
      const w = yield* call("what_if", input);
      if (w.error) {
        say(str(w.error));
        break;
      }
      const changed = arr(w.changed);
      if (changed.length === 0) say("Nothing I'd recommend changes.");
      for (const c of changed.slice(0, 4)) say(`- ${str(c.title)} [${str(c.id)}]: ${str(c.before)} → ${str(c.after)}.`);
      for (const f of arr(w.figures).slice(0, 3)) say(`- ${str(f.label)}: ${str(f.before)} → ${str(f.after)}.`);
      if (strs(w.unchanged).length) say(`Unchanged: ${strs(w.unchanged).map((x) => `[${x}]`).join(" ")}.`);
      if (w.fault_promise) say(`The promise under test: ${str(w.fault_promise)}`);
      say(str(w.note));
      break;
    }

    case "hidden": {
      const p = yield* call("get_pulse");
      say(`${str(p.signals_arrived)} signals arrived. ${str(p.signals_that_changed_a_decision)} changed a decision. ${str(p.needs_the_owner_now)} need you. Some of what I kept from you:`);
      for (const h of arr(p.hidden).slice(0, 6)) say(`- ${str(h.at)} · ${str(h.what)} ${str(h.why)}`);
      break;
    }

    case "can_wait": {
      const l = yield* call("list_decisions");
      const now = decisions(l).filter((d) => str(d.lane) !== "can wait" && isOpen(d));
      const later = decisions(l).filter((d) => str(d.lane) === "can wait");
      say(later.length ? "These can wait:" : "Nothing open can wait.");
      for (const d of later) say(`- ${str(d.title)} ${cite(d)}, ${str(d.by).toLowerCase()}.`);
      if (now.length) say(`These can't: ${now.map((d) => `${str(d.title).toLowerCase()} ${cite(d)} (${str(d.by).toLowerCase()})`).join("; ")}.`);
      break;
    }

    case "explain": {
      const l = yield* call("list_decisions");
      const top = firstNeeding(l) ?? decisions(l)[0];
      if (!top) {
        say("There's nothing open to explain.");
        break;
      }
      const audience = has(q, "engineer") ? "engineering" : has(q, "owner") ? "owner" : "gm";
      const x = yield* call("explain", { id: str(top.id), audience });
      say(`${audience === "gm" ? "For the floor" : audience === "engineering" ? "For engineering" : "For the owner"} ${cite(top)}:`);
      for (const line of strs(x.explanation)) say(audience === "engineering" ? `- ${line}` : line);
      break;
    }

    case "receipts": {
      const p = yield* call("get_pulse");
      say(`${str(p.headline)} ${str(p.detail)}`);
      if (p.phase !== "closed" && p.phase !== "remembered") {
        const sim = yield* call("simulate_night");
        if (sim.available === true) say(`It hasn't closed yet. Run forward with my plan, tickets peak at ${str(obj(sim.savy_plan).worst_ticket_minutes)} minutes. ${str(sim.caveat)}`);
      }
      break;
    }

    case "changed": {
      const w = yield* call("what_changed", { since: has(q, "noon") ? "12:00" : "00:00" });
      say(`${str(w.count)} things changed what I know, as of ${str(w.as_of)}:`);
      for (const e of arr(w.events).slice(-8)) say(`- ${str(e.at)} · ${str(e.from)}: ${str(e.text)} [${str(e.id)}]`);
      break;
    }

    case "memory": {
      const m = yield* call("get_memory");
      const memories = arr(m.memories);
      say(`I hold ${memories.length} memories about this restaurant. Each is built from nights and outcomes, never a guess about you.`);
      for (const x of memories.slice(0, 5)) {
        say(`- ${str(x.statement)} ${str(x.status)}: ${str(x.supporting_nights)} supporting, ${str(x.counterexamples)} against${x.status === "needs revalidation" ? ". It may no longer hold" : ""}. [${str(x.id)}]`);
      }
      say(str(m.caveat));
      break;
    }

    case "history": {
      const s = yield* call("get_shadow_summary");
      say(`Over the last ${str(s.services)} services I would have noticed ${str(s.detected)} situations: ${str(s.useful)} useful, ${str(s.alreadyHandled)} already handled by your team, ${str(s.noise)} noise.`);
      say(`${str(s.surfaced)} would have reached you. You did the same thing in ${str(s.agree)} of them.`);
      say(str(s.caveat));
      break;
    }

    case "confidence":
    case "staffing": {
      const l = yield* call("list_decisions");
      const top = decisions(l).find((d) => str(d.id) === "DEC-STAFF") ?? firstNeeding(l);
      if (!top) {
        say("Nothing is open tonight.");
        break;
      }
      const d = yield* call("get_decision", { id: str(top.id) });
      if (intent === "confidence") {
        const c = obj(d.confidence);
        say(`Confidence on ${str(d.title).toLowerCase()} ${cite(d)} is ${str(c.level)}. ${strs(c.reasons).join(" ")}`);
        const mind = strs(d.would_change_my_mind)[0];
        if (mind) say(`What would change my mind: ${mind}`);
        break;
      }
      sayDecision(d);
      const versions = arr(d.versions);
      if (versions.length > 1) say(`It's on ${str(versions.at(-1)?.version)}: ${versions.map((v) => `${str(v.version)} at ${str(v.at)} after ${str(v.cause)}`).join("; ")}.`);
      break;
    }

    case "unknown": {
      const l = yield* call("list_decisions");
      const open = decisions(l).filter(isOpen).slice(0, 3);
      if (open.length === 0) say("Nothing open depends on something I don't know.");
      for (const row of open) {
        const d = yield* call("get_decision", { id: str(row.id) });
        const unknown = strs(d.still_unknown);
        if (unknown.length) say(`- ${str(d.title)} ${cite(d)}: ${unknown[0]}`);
      }
      say("Unknown is never counted as zero.");
      break;
    }

    case "item": {
      const item = itemIn(q) ?? "burrata";
      const d = yield* decisionById(`DEC-${item.toUpperCase()}`);
      if (d) {
        sayDecision(d);
        break;
      }
      const inv = yield* call("get_surface", { surface: "inventory" });
      const row = arr(inv.items).find((x) => str(x.item).toLowerCase().startsWith(item));
      if (!row) say(`I don't track ${item} tonight.`);
      else {
        say(
          `${str(row.item)}: ${str(row.on_the_line)} on the line, ${str(row.in_backup)} in backup, ${str(row.forecast_tonight)} forecast. Status: ${str(row.status)}.${row.line_count_id ? ` [${str(row.line_count_id)}]` : ""}`,
        );
      }
      break;
    }

    case "invoice": {
      const inv = yield* call("get_surface", { surface: "invoices" });
      const list = arr(inv.invoices);
      if (list.length === 0) say("No invoices arrived tonight.");
      for (const i of list) {
        say(`${str(i.vendor)} ${str(i.number)}: ${str(i.total)} against ${str(i.on_contract)} on contract, ${str(i.over_contract)} over. [${str(i.id)}]`);
        say(`Price effect ${str(i.price_effect)}, volume effect ${str(i.volume_effect)}. It reads as ${str(i.verdict)}.${Number(i.duplicates_suppressed) > 0 ? " It arrived twice; it's counted once." : ""}`);
      }
      break;
    }

    case "order": {
      const po = yield* call("get_surface", { surface: "purchasing" });
      const lines = arr(po.lines);
      if (lines.length === 0) say("Tomorrow's standing order covers it. Nothing to add.");
      for (const l of lines) say(`- ${str(l.item)} ${Number(l.qty) > 0 ? "+" : ""}${str(l.qty)}: ${str(l.why)}`);
      if (lines.length) say(`Total ${str(po.total)}. Status: ${str(po.status)}. ${str(po.note)}`);
      for (const v of strs(po.vendor_log)) say(`- ${v}`);
      break;
    }

    case "cash": {
      const cash = yield* call("get_surface", { surface: "cash" });
      say(`Weekly cash was ${str(cash.weekly_cash_before_tonight)} before tonight; it projects to ${str(cash.projected_weekly_cash)}. Your floor is ${str(cash.owner_floor)}.`);
      for (const l of arr(cash.lines)) say(`- ${str(l.what)}: ${str(l.amount)} (${str(l.status)})`);
      say(`Tonight's proposed decisions change it by ${str(cash.tonights_proposed_decisions_change_cash_by)}. ${str(cash.note)}`);
      break;
    }

    case "help": {
      const p = yield* call("get_pulse");
      say(`I'm Savy. Right now: ${str(p.headline)}`);
      say("I can tell you what needs you, show the evidence, fork the night with a what-if, run it forward with and without my plan, and tell you what I've learned. I can prepare and ask. I can't act.");
      break;
    }

    case "attention": {
      const p = yield* call("get_pulse");
      say(`${str(p.headline)} ${str(p.detail)}`);
      const l = yield* call("list_decisions");
      const top = firstNeeding(l);
      if (top) sayDecision(yield* call("get_decision", { id: str(top.id) }));
      const later = decisions(l).filter((d) => str(d.lane) === "can wait");
      if (later.length) say(`Can wait: ${later.map((d) => `${str(d.title).toLowerCase()} ${cite(d)}`).join("; ")}.`);
      break;
    }
  }

  const text = lines.join("\n");
  // Streamed a few words at a time so the answer arrives the way a model's would.
  const words = text.split(/(?<=\s)/);
  for (let i = 0; i < words.length; i += 4) {
    yield { type: "text.delta", text: words.slice(i, i + 4).join("") };
    await pace("text");
  }
  return { text, toolResults };
}
