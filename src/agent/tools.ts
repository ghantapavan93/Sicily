import { formatAge, formatClock } from "@/domain/clock";
import { SERVICES, SITUATIONS } from "@/shadow/history";
import {
  agreementOf,
  classify,
  CLASSIFICATION_RULE,
  detectedOf,
  kindLabel,
  OPERATOR_LABEL,
  recommendationOf,
  summarize,
  SURFACE_MIN_USD,
  titleOf,
} from "@/shadow/replay";
import type { SituationKind } from "@/shadow/types";
import { forkOf } from "@/twin/consequence";
import { forkNight, type Assumptions } from "@/twin/fork";
import { one, pct, signedUsd, unitUsd, usd } from "@/twin/format";
import { FAULT_ORDER, FAULTS } from "@/twin/ledger";
import { OPERATING_DNA } from "@/twin/memory";
import { attentionOf, pulseOf } from "@/twin/pulse";
import { memoriesFor } from "@/twin/recall";
import { APPROVABLE, evaluate, type Evaluation, type TwinState } from "@/twin/runtime";
import { SOURCE_ORDER, SOURCES } from "@/twin/sources";
import type { Decision, FaultId, ItemId, NightRun, SourceId } from "@/twin/types";
import type { Proposal, ProposalAction } from "./protocol";

/**
 * Savy's tools. Each one is a thin, read-only projection of the restaurant
 * twin the screen uses. The agent cannot compute a number, pick between
 * sources or change state: it can read, run a what-if on a copy, and ask a
 * person to act.
 */

export interface AgentContext {
  state: TwinState;
  ev: Evaluation;
  /** Proposals made during this run. The route forwards them to the screen. */
  proposals: Proposal[];
}

export function contextFor(state: TwinState): AgentContext {
  return { state, ev: evaluate(state), proposals: [] };
}

export class ToolInputError extends Error {}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  run: (ctx: AgentContext, input: Record<string, unknown>) => unknown;
  /** One line for the trace. Never the full result. */
  summarize: (result: unknown) => string;
}

function enumArg<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = input[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ToolInputError(`"${key}" must be one of: ${allowed.join(", ")}`);
  return value as T;
}
const optionalEnum = <T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T | null =>
  input[key] === undefined || input[key] === null ? null : enumArg(input, key, allowed);
function optionalInt(input: Record<string, unknown>, key: string, min: number, max: number): number | null {
  const v = input[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ToolInputError(`"${key}" must be a number from ${min} to ${max}`);
  return Math.round(v);
}

const ITEMS: ItemId[] = ["burrata", "branzino", "greens"];
const SURFACES = ["staffing", "inventory", "purchasing", "invoices", "cash", "health"] as const;
const AUDIENCES = ["owner", "gm", "engineering"] as const;
const KINDS: SituationKind[] = ["coverage_gap", "prep_shortfall", "overtime_drift", "invoice_variance", "beverage_overorder", "stale_source", "late_clockin", "comp_void_spike"];
const PROPOSAL_KINDS = ["approve", "ask_manager", "recheck_pos", "submit_po"] as const;

const serviceLabel = (index: number) => SERVICES.find((d) => d.index === index)?.label ?? `Service ${index}`;
const at = (m: number | null) => (m === null ? null : formatClock(m));

function decisionArg(ctx: AgentContext, input: Record<string, unknown>): Decision {
  const raw = typeof input.id === "string" ? input.id.trim() : "";
  const d = ctx.ev.decisions.find((x) => x.id.toLowerCase() === raw.toLowerCase() || x.key === raw);
  if (!d) throw new ToolInputError(`No decision "${raw}". Open decisions: ${ctx.ev.decisions.map((x) => x.id).join(", ") || "none"}`);
  return d;
}

const row = (d: Decision) => ({
  id: d.id,
  title: d.title,
  lane: d.lane === "now" ? "needs you now" : d.lane === "missing_fact" ? "missing fact" : "can wait",
  status: d.status,
  recommendation: d.recommendation?.action ?? null,
  approvable: APPROVABLE.has(d.status) && Boolean(d.recommendation?.approvable),
  by: d.urgency.label,
});

const night = (r: NightRun) => ({
  label: r.label,
  actions: r.actions,
  covers: r.totals.covers,
  sales: usd(r.totals.sales),
  wages: usd(r.totals.wages),
  labor: pct(r.totals.laborPct),
  peak_covers_per_server: one(r.totals.peakLoad),
  worst_ticket_minutes: String(r.totals.worstTicket),
  walk_ins_lost: r.totals.walkAways,
  sold_out: r.totals.soldOut.map((x) => `${x.name} at ${formatClock(x.at)}`),
});

const PROPOSAL_LABEL: Record<ProposalAction["kind"], string> = {
  approve: "Approve",
  ask_manager: "Ask the manager",
  recheck_pos: "Re-check POS",
  submit_po: "Submit the order",
};

/** Whether a proposal could be acted on right now. The same rules the screen's buttons follow. */
export function proposalEligibility(ctx: AgentContext, action: ProposalAction): { ok: true } | { ok: false; why: string } {
  if (ctx.state.phase !== "live") return { ok: false, why: "Tonight's decisions are not open." };
  const decisions = ctx.ev.decisions;
  switch (action.kind) {
    case "approve": {
      const d = decisions.find((x) => x.key === action.decision);
      if (!d) return { ok: false, why: "There is no such decision tonight." };
      if (!APPROVABLE.has(d.status) || !d.recommendation?.approvable) {
        return { ok: false, why: d.status === "approved" || d.status === "rejected" ? "It has already been decided." : "Savy isn't standing behind a recommendation there. The evidence isn't sufficient." };
      }
      if (action.version !== undefined && action.version !== (ctx.state.versions[action.decision]?.length ?? 0)) {
        return { ok: false, why: "The recommendation has changed since Savy proposed this. Open the decision to see the current one." };
      }
      return { ok: true };
    }
    case "ask_manager":
      // Same rule as the reducer: the item and the place (line or walk-in) must be what a decision is waiting on.
      return decisions.some((d) => d.remedies.some((r) => r.kind === "ask_manager" && r.item === action.item && r.place === action.place))
        ? { ok: true }
        : { ok: false, why: "No decision is waiting on that count." };
    case "recheck_pos":
      return decisions.some((d) => d.remedies.some((r) => r.kind === "recheck_pos")) ? { ok: true } : { ok: false, why: "Sales are already current." };
    case "submit_po":
      return ctx.state.po === "approved" && !ctx.state.submission ? { ok: true } : { ok: false, why: "The order must be approved, and not yet submitted." };
  }
}

export const TOOLS: ToolSpec[] = [
  {
    name: "get_pulse",
    description:
      "Tonight at a glance: the scenario clock, the Daily Pulse headline, how many decisions need a person, how many facts are missing, what can wait, and the attention budget (signals arrived, how many changed a decision, how many need the owner, and what was hidden and why).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: (ctx) => {
      const p = pulseOf(ctx.state);
      const a = attentionOf(ctx.state);
      return {
        night: ctx.ev.scenario.service,
        as_of: formatClock(ctx.state.processedThrough),
        phase: ctx.state.phase,
        headline: p.headline,
        detail: p.sub,
        decisions: p.counts.decisions,
        missing_facts: p.counts.missing,
        can_wait: p.counts.canWait,
        signals_arrived: a.signals,
        signals_that_changed_a_decision: a.changedDecision,
        needs_the_owner_now: a.needsYou,
        hidden: a.hidden.slice(0, 8).map((h) => ({ what: h.what, why: h.why, at: formatClock(h.at) })),
      };
    },
    summarize: (r) => {
      const x = r as { decisions: number; signals_arrived: number };
      return `${x.signals_arrived} signals · ${x.decisions} decisions`;
    },
  },
  {
    name: "list_decisions",
    description:
      "Every decision Savy has open tonight, grouped by lane (needs you now, missing fact, can wait), with status, the recommendation if Savy stands behind one, whether it can be approved, and by when. Cite decisions by id, e.g. [DEC-STAFF].",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: (ctx) => ({
      as_of: formatClock(ctx.state.processedThrough),
      decisions: ctx.ev.decisions.map(row),
      waiting_on_counts: ctx.ev.decisions.flatMap((d) => d.remedies.flatMap((r) => (r.kind === "ask_manager" ? [{ decision: d.id, item: r.item, place: r.place }] : []))),
    }),
    summarize: (r) => `${(r as { decisions: unknown[] }).decisions.length} decisions`,
  },
  {
    name: "get_decision",
    description:
      "One decision in full: what changed, why it matters, the recommendation, what Savy still doesn't know, what would change its mind, who has authority, Savy's autonomy level and permission envelope, the guard result, priced effects, evidence with event ids, confidence with reasons, what happens if nothing is done, and its version history. Every figure about a decision must come from here.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "Decision id, e.g. DEC-STAFF" } }, required: ["id"], additionalProperties: false },
    run: (ctx, input) => {
      const d = decisionArg(ctx, input);
      return {
        id: d.id,
        title: d.title,
        status: d.status,
        headline: d.headline,
        what_changed: d.whatChanged,
        why_it_matters: d.whyItMatters,
        recommendation: d.recommendation,
        approvable: APPROVABLE.has(d.status) && Boolean(d.recommendation?.approvable),
        still_unknown: d.stillUnknown,
        would_change_my_mind: d.wouldChangeMind,
        authority: d.authority,
        autonomy: d.autonomy,
        permissions: d.permissions,
        guard: { requires_owner_approval: d.guard.requiresApproval, evidence_sufficient: d.guard.evidenceSufficient, external_action_allowed: false, rules: d.guard.rules },
        effects: d.effects,
        evidence: d.evidence.map((e) => ({ id: e.eventId, source: SOURCES[e.source].label, label: e.label, value: e.value, basis: e.basis, freshness: e.freshness, at: at(e.at) })),
        confidence: d.confidence,
        if_nothing_is_done: d.doNothing,
        by: d.urgency.label,
        versions: (ctx.state.versions[d.key] ?? []).map((v) => ({ version: `v${v.version}`, at: formatClock(v.at), status: v.status, summary: v.summary, cause: v.cause })),
      };
    },
    summarize: (r) => {
      const x = r as { id: string; status: string; confidence: { level: string } };
      return `${x.id} · ${x.status} · confidence ${x.confidence.level}`;
    },
  },
  {
    name: "get_surface",
    description:
      "One operating surface of the twin: staffing (floor, call-outs, peak load, labor), inventory (counts, forecasts, run-out times), purchasing (tomorrow's draft order and its status), invoices (contract vs actual, price vs volume), cash (weekly projection and what tonight's decisions do to it), or health (each source's freshness).",
    input_schema: { type: "object", properties: { surface: { type: "string", enum: SURFACES } }, required: ["surface"], additionalProperties: false },
    run: (ctx, input) => {
      const surface = enumArg(input, "surface", SURFACES);
      const t = ctx.ev.twin;
      switch (surface) {
        case "staffing":
          return {
            surface,
            booked_covers: t.demand.booked?.value ?? null,
            disputed_count: t.demand.disputed?.value ?? null,
            peak_hour_covers: t.demand.peakCovers,
            servers_on_floor: t.staffing.servers,
            called_out: t.staffing.calledOut.map((s) => `${s.name}, ${formatClock(s.start)}`),
            added: t.staffing.added.map((s) => `${s.name}, ${formatClock(s.start)} to ${formatClock(s.end)}`),
            early_out: t.staffing.cut.map((s) => `${s.name} at ${formatClock(s.start)}`),
            on_call: t.staffing.onCall?.name ?? null,
            peak_covers_per_server: t.staffing.peakLoad === null ? null : one(t.staffing.peakLoad),
            with_one_more_server: t.staffing.loadWithOneMore === null ? null : one(t.staffing.loadWithOneMore),
            ceiling: String(t.staffing.ceiling),
            wages_tonight: usd(t.labor.wages),
            projected_sales: t.labor.projectedSales === null ? null : usd(t.labor.projectedSales),
            labor: t.labor.pct === null ? null : pct(t.labor.pct),
            labor_goal: `${t.labor.goalPct}%`,
          };
        case "inventory":
          return {
            surface,
            items: t.inventory.map((i) => ({
              item: i.name,
              on_the_line: i.line?.value ?? null,
              line_count_id: i.line?.eventId ?? null,
              in_backup: i.backup?.value ?? "not counted",
              forecast_tonight: i.forecast,
              short_by: i.exposure,
              runs_out_at: at(i.runOutAt),
              status: i.status.replace(/_/g, " "),
            })),
          };
        case "purchasing":
          return {
            surface,
            status: t.purchasing.status,
            lines: t.purchasing.lines.map((l) => ({ item: l.name, qty: l.qty, unit_cost: unitUsd(l.unitCost), why: l.why })),
            total: `${t.purchasing.total < 0 ? "−" : ""}${usd(t.purchasing.total)}`,
            orders: t.purchasing.orders,
            vendor_log: ctx.state.submission?.log.map((l) => `${formatClock(l.at)} ${l.text}`) ?? [],
            note: "Draft only. Owner approval required. Savy can't submit it.",
          };
        case "invoices":
          return {
            surface,
            invoices: t.invoices.map((i) => ({
              id: i.eventId,
              vendor: i.vendor,
              number: i.number,
              total: usd(i.total),
              on_contract: usd(i.contractTotal),
              previous_average: usd(i.previousAvg),
              over_contract: `${Math.round(i.deltaPct)}%`,
              price_effect: signedUsd(i.priceEffect),
              volume_effect: signedUsd(i.volumeEffect),
              verdict: i.verdict === "price" ? "price change, not volume" : i.verdict === "volume" ? "volume, not price" : i.verdict === "both" ? "price and volume" : "in line",
              duplicates_suppressed: i.duplicatesSuppressed,
            })),
          };
        case "cash":
          return {
            surface,
            weekly_cash_before_tonight: usd(t.cash.baseline),
            owner_floor: usd(t.cash.floor),
            lines: t.cash.lines.map((l) => ({ what: l.label, amount: signedUsd(l.amount), status: l.status })),
            projected_weekly_cash: usd(t.cash.projected),
            tonights_proposed_decisions_change_cash_by: signedUsd(t.cash.proposedDelta),
            with_tonights_pace_estimate: usd(t.cash.withEstimates),
            note: "Estimated lines are shown, never added to the projection.",
          };
        case "health":
          return { surface, sources: t.health.map((h) => ({ source: SOURCES[h.source].label, last: at(h.last), age: formatAge(h.ageMin), freshness: h.freshness })) };
      }
    },
    summarize: (r) => `${(r as { surface: string }).surface}`,
  },
  {
    name: "what_changed",
    description: "What arrived and what Savy did, in order: each non-routine event Savy processed with its id and time, then the audit lines. Optionally only since a time like 17:00.",
    input_schema: { type: "object", properties: { since: { type: "string", description: "24-hour time, e.g. 12:00" } }, required: [], additionalProperties: false },
    run: (ctx, input) => {
      const m = typeof input.since === "string" ? /^(\d{1,2}):(\d{2})$/.exec(input.since.trim()) : null;
      const since = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
      const events = ctx.ev.processed.filter((e) => !e.routine && e.availableAt >= since);
      return {
        since: formatClock(since),
        as_of: formatClock(ctx.state.processedThrough),
        count: events.length,
        events: events.slice(-14).map((e) => ({ id: e.id, at: formatClock(e.availableAt), from: SOURCES[e.source].label, kind: e.kind, text: e.summary })),
        savy: ctx.state.audit.filter((a) => a.at >= since && a.actor !== "system").slice(-8).map((a) => `${formatClock(a.at)} · ${a.actor} · ${a.label}`),
      };
    },
    summarize: (r) => `${(r as { count: number }).count} events`,
  },
  {
    name: "read_source",
    description: "Everything one connected system has sent today that Savy has processed, with event ids, and how fresh that system is right now.",
    input_schema: { type: "object", properties: { source: { type: "string", enum: SOURCE_ORDER } }, required: ["source"], additionalProperties: false },
    run: (ctx, input) => {
      const source = enumArg<SourceId>(input, "source", SOURCE_ORDER);
      const h = ctx.ev.twin.health.find((x) => x.source === source)!;
      const events = ctx.ev.processed.filter((e) => e.source === source);
      return {
        source: SOURCES[source].label,
        freshness: h.freshness,
        last: at(h.last),
        age: formatAge(h.ageMin),
        stale_after_minutes: SOURCES[source].staleAfterMin,
        events: events.slice(-8).map((e) => ({ id: e.id, at: formatClock(e.availableAt), text: e.summary, routine: e.routine })),
      };
    },
    summarize: (r) => {
      const x = r as { source: string; freshness: string };
      return `${x.source} · ${x.freshness}`;
    },
  },
  {
    name: "simulate_night",
    description:
      "Run the rest of tonight twice from the current twin: once with no change, once with Savy's plan. Returns covers, sales, wages, labor, peak load, worst ticket time, walk-ins lost and what sells out, for each. Synthetic and deterministic: a way to see a choice's consequence, not a promise of money.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: (ctx) => {
      if (ctx.state.phase === "idle" || ctx.state.phase === "arriving" || ctx.state.phase === "waiting" || ctx.state.phase === "processing")
        return { available: false, why: "Savy hasn't finished reading tonight, so there is no plan to run forward yet." };
      const fork = forkOf(ctx.ev.scenario, ctx.ev.twin, ctx.ev.decisions);
      if (!fork) return { available: false, why: "The cover count isn't settled, so the night can't be run forward." };
      return { available: true, no_change: night(fork.nothing), savy_plan: night(fork.plan), caveat: "Simulated. Not a forecast of real money." };
    },
    summarize: (r) => ((r as { available: boolean }).available ? "two branches run to close" : "not available"),
  },
  {
    name: "what_if",
    description:
      "Fork tonight on a copy and rerun the engine with one changed assumption: covers (a new booked count), backup_item with backup_units, on_call_declines, event_cancelled, or a fault to dry-run. Returns which decisions changed, which didn't, and the figures that moved. The live night is untouched.",
    input_schema: {
      type: "object",
      properties: {
        covers: { type: "number" },
        backup_item: { type: "string", enum: ITEMS },
        backup_units: { type: "number" },
        on_call_declines: { type: "boolean" },
        event_cancelled: { type: "boolean" },
        fault: { type: "string", enum: FAULT_ORDER },
      },
      required: [],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const a: Assumptions = {};
      const covers = optionalInt(input, "covers", 0, 400);
      if (covers !== null) a.covers = covers;
      const item = optionalEnum(input, "backup_item", ITEMS);
      const units = optionalInt(input, "backup_units", 0, 200);
      if (item && units !== null) a.backup = { [item]: units };
      if (input.on_call_declines === true) a.onCallDeclines = true;
      if (input.event_cancelled === true) a.eventCancelled = true;
      const fault = optionalEnum<FaultId>(input, "fault", FAULT_ORDER);
      if (fault) a.faults = [fault];
      if (Object.keys(a).length === 0) throw new ToolInputError("Give one assumption to change.");
      const f = forkNight(ctx.state, a);
      return {
        assumption: input,
        fault_promise: fault ? FAULTS[fault].promise : null,
        changed: f.changed.map((c) => ({ id: c.id, title: c.title, before: c.before ?? "no decision", after: c.after ?? "no decision" })),
        unchanged: f.unchanged.map((u) => u.id),
        figures: f.figures,
        note: "A dry run on a copy of tonight. Nothing live changed.",
      };
    },
    summarize: (r) => {
      const x = r as { changed: unknown[]; unchanged: unknown[] };
      return `${x.changed.length} changed · ${x.unchanged.length} unchanged`;
    },
  },
  {
    name: "explain",
    description: "The same decision told three ways: owner (what it means), gm (what to do on the floor) or engineering (rules, gates, inputs).",
    input_schema: { type: "object", properties: { id: { type: "string" }, audience: { type: "string", enum: AUDIENCES } }, required: ["id", "audience"], additionalProperties: false },
    run: (ctx, input) => {
      const d = decisionArg(ctx, input);
      const audience = enumArg(input, "audience", AUDIENCES);
      return { id: d.id, audience, explanation: audience === "engineering" ? d.explain.engineering : [d.explain[audience]] };
    },
    summarize: (r) => `${(r as { id: string }).id} · ${(r as { audience: string }).audience}`,
  },
  {
    name: "get_memory",
    description:
      "Decision memory: each memory with its status (pattern, candidate, needs revalidation), supporting nights, counterexamples, when it was last validated and what Savy does because of it. Plus the restaurant's operating DNA. Cite memories by id.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: (ctx) => ({
      memories: memoriesFor(ctx.state).map((m) => ({
        id: m.id,
        statement: m.statement,
        status: m.status.replace("_", " "),
        supporting_nights: m.supporting.length,
        counterexamples: m.counter.length,
        last_validated: m.lastValidated,
        taught_by_owner: m.createdBy === "owner",
        updated_tonight: m.updatedTonight,
        next_time: m.usage,
      })),
      operating_dna: OPERATING_DNA.flatMap((g) => g.traits.map((t) => `${t.label}: ${t.value}`)),
      caveat: "Synthetic history.",
    }),
    summarize: (r) => `${(r as { memories: unknown[] }).memories.length} memories`,
  },
  {
    name: "get_shadow_summary",
    description:
      "Savy Shadow over the last 30 services: situations detected, useful, already handled, noise, how many would have reached the owner, and how often the operator did the same thing. Synthetic.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    run: () => ({
      ...summarize(),
      rules: { ...CLASSIFICATION_RULE, surfaced: `Owner-level kind with at least $${SURFACE_MIN_USD} at stake.` },
      caveat: "Synthetic prototype data. Agreement with the operator is not the same as being right.",
    }),
    summarize: (r) => {
      const s = r as { detected: number; surfaced: number; agree: number };
      return `${s.detected} detected · ${s.agree} of ${s.surfaced} matched`;
    },
  },
  {
    name: "search_history",
    description: "Past situations from the last 30 services, filterable by kind or to disagreements with the operator. Cite rows by id, e.g. [COV-02].",
    input_schema: {
      type: "object",
      properties: { kind: { type: "string", enum: KINDS }, only_disagreements: { type: "boolean" } },
      required: [],
      additionalProperties: false,
    },
    run: (_ctx, input) => {
      const kind = optionalEnum(input, "kind", KINDS);
      const rows = SITUATIONS.filter((s) => (kind ? s.params.kind === kind : true))
        .filter((s) => (input.only_disagreements === true ? agreementOf(s) === "disagree" : true))
        .slice(0, 8)
        .map((s) => ({
          id: s.id,
          service: serviceLabel(s.service),
          kind: kindLabel(s),
          title: titleOf(s),
          savy_would_have_said: `${detectedOf(s)} ${recommendationOf(s)}`,
          operator_did: OPERATOR_LABEL[s.operator.action],
          operator_reason: s.operator.reason ?? null,
          what_happened: s.result.note,
          classification: classify(s),
        }));
      return { count: rows.length, rows };
    },
    summarize: (r) => `${(r as { count: number }).count} past situations`,
  },
  {
    name: "propose_action",
    description:
      "Put an action in front of the person as a button. Nothing happens until they press it. approve needs decision (a decision id); ask_manager needs item and place (line or backup); recheck_pos and submit_po need nothing else. Always give a one-sentence reason. Rejected if the engine wouldn't allow it now.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: PROPOSAL_KINDS },
        decision: { type: "string" },
        item: { type: "string", enum: ITEMS },
        place: { type: "string", enum: ["line", "backup"] },
        reason: { type: "string" },
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    run: (ctx, input) => {
      const kind = enumArg(input, "action", PROPOSAL_KINDS);
      const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 240) : "";
      if (!reason) throw new ToolInputError('"reason" must be a non-empty sentence');
      let action: ProposalAction;
      let label = PROPOSAL_LABEL[kind];
      if (kind === "approve") {
        const d = decisionArg(ctx, { id: input.decision });
        action = { kind, decision: d.key, version: ctx.state.versions[d.key]?.length ?? 0 };
        label = `Approve: ${d.recommendation?.action ?? d.title}`;
      } else if (kind === "ask_manager") {
        const item = enumArg(input, "item", ITEMS);
        const place = enumArg(input, "place", ["line", "backup"] as const);
        action = { kind, item, place };
        label = `Ask the manager for a ${place === "backup" ? "walk-in" : "line"} count of ${ctx.ev.scenario.items[item]?.name.toLowerCase() ?? item}`;
      } else action = { kind };
      const eligible = proposalEligibility(ctx, action);
      if (!eligible.ok) return { status: "rejected", why: eligible.why };
      const proposal: Proposal = { id: `prop_${ctx.proposals.length + 1}`, action, label, reason };
      ctx.proposals.push(proposal);
      return { status: "waiting_for_person", proposal_id: proposal.id, note: "Nothing has been done. The person must confirm on screen." };
    },
    summarize: (r) => {
      const x = r as { status: string; why?: string };
      return x.status === "rejected" ? `rejected · ${x.why}` : "waiting for a person";
    },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

export interface ToolRun {
  result: unknown;
  json: string;
  summary: string;
  isError: boolean;
}

/** Runs one tool call. A bad input or an unknown tool becomes an error result, never a throw. */
export function runTool(ctx: AgentContext, name: string, input: unknown): ToolRun {
  const tool = toolByName(name);
  if (!tool) {
    const result = { error: `Unknown tool "${name}".` };
    return { result, json: JSON.stringify(result), summary: "unknown tool", isError: true };
  }
  const safeInput = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  try {
    const result = tool.run(ctx, safeInput);
    return { result, json: JSON.stringify(result), summary: tool.summarize(result), isError: false };
  } catch (err) {
    if (!(err instanceof ToolInputError)) throw err;
    const result = { error: err.message };
    return { result, json: JSON.stringify(result), summary: `invalid input · ${err.message}`, isError: true };
  }
}
