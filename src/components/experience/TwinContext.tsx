"use client";

import { useReducedMotion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { attentionOf, pulseOf, traceOf, type Attention, type EngineTrace, type Pulse } from "@/twin/pulse";
import { decodeSession, encodeSession, evaluate, fold, initialTwin, twinReducer, type Evaluation, type TwinAction, type TwinState } from "@/twin/runtime";
import type { DecisionKey, ScenarioId } from "@/twin/types";
import type { MomentKind } from "../ui/savy-moment";

/**
 * LIVE is tonight. TRY IT forks it and swaps nights. LAB breaks it on purpose.
 * MEMORY is what was learned. FUTURE is where it could go. ASK is Savy.
 * Every mode reads the same state through the same reducer.
 */
export type Mode = "live" | "try" | "lab" | "memory" | "future" | "ask";
/** The do-nothing theater: the no-change branch alone, then Savy's plan beside it, then the comparison. */
export type TheaterStage = "nothing" | "plan" | "both";
export type View = "operator" | "engineering";

/**
 * One of the three moments Savy's spectrum is reserved for. It exists for a
 * few seconds and is then gone, so the light can't linger.
 */
export interface SavyMoment {
  kind: MomentKind;
  id: number;
  /** Decisions the moment is about. */
  keys: DecisionKey[];
}

export interface Session {
  log: TwinAction[];
  /** Null means live. A number means the screen shows the state after that many actions. */
  cursor: number | null;
  live: boolean;
  travelTo: (cursor: number | null) => void;
  link: () => string;
}

interface TwinContextValue {
  state: TwinState;
  ev: Evaluation;
  pulse: Pulse;
  attention: Attention;
  dispatch: (action: TwinAction) => void;
  actionLog: () => TwinAction[];
  session: Session;
  mode: Mode;
  goTo: (mode: Mode) => void;
  view: View;
  setView: (view: View) => void;
  /** The decision open in the Decision Room. */
  room: DecisionKey | null;
  openRoom: (key: DecisionKey | null) => void;
  /** The "what if I do nothing" theater, and which stage of it is showing. Null when closed. */
  theater: TheaterStage | null;
  setTheater: (stage: TheaterStage | null) => void;
  pressure: boolean;
  setPressure: (open: boolean) => void;
  /** What the six engines did with the last thing Savy read. */
  trace: EngineTrace | null;
  traceSeq: number;
  moment: SavyMoment | null;
  focusedSituation: string | null;
  openSituation: (id: string | null) => void;
  openNight: (scenario: ScenarioId) => void;
  reset: () => void;
}

const TwinContext = createContext<TwinContextValue | null>(null);

const MODES: readonly Mode[] = ["live", "try", "lab", "memory", "future", "ask"];
const PACE = {
  arrive: [700, 180],
  process: [1250, 260],
  manager: [3400, 400],
  vendor: [2600, 300],
  remember: [2400, 300],
} as const;
const MOMENT_MS = 4200;
/** Audit lines that mean Savy's recommendation itself moved. */
const MOVED = new Set(["recommendation.withdrawn", "recommendation.restored", "decision.changed", "decision.resolved", "decision.drafted", "decision.closed"]);

function readLink(): { actions: TwinAction[]; mode: Mode | null; view: View | null } | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("s");
  if (!token) return null;
  const actions = decodeSession(token);
  if (actions.length === 0) return null;
  const m = params.get("m");
  const v = params.get("v");
  return { actions, mode: MODES.find((x) => x === m) ?? null, view: v === "engineering" || v === "operator" ? v : null };
}

export function TwinProvider({ children }: { children: ReactNode }) {
  const [liveState, setLiveState] = useState<TwinState>(initialTwin);
  const liveStateRef = useRef<TwinState>(initialTwin);
  const [log, setLog] = useState<TwinAction[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("live");
  const [view, setView] = useState<View>("operator");
  const [room, setRoom] = useState<DecisionKey | null>(null);
  const [theater, setTheater] = useState<TheaterStage | null>(null);
  const [pressure, setPressure] = useState(false);
  const [focusedSituation, setFocusedSituation] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const pace = (k: keyof typeof PACE) => PACE[k][reducedMotion ? 1 : 0];

  const live = cursor === null;
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // The past is read-only: while an earlier point is on screen, nothing can be dispatched into it.
  // The reducer runs here, synchronously, so an action it refuses never reaches the log or a link.
  const dispatch = useCallback((action: TwinAction) => {
    if (!liveRef.current && action.type !== "RESET") return;
    const before = liveStateRef.current;
    const next = twinReducer(before, action);
    if (next === before && action.type !== "RESET") return;
    liveStateRef.current = next;
    // A new night starts from nothing, so its log does too: links and Savy's replay carry only this night.
    setLog((current) => (action.type === "RESET" ? [] : action.type === "OPEN" ? [action] : [...current, action]));
    if (action.type === "RESET") setCursor(null);
    setLiveState(next);
  }, []);

  const viewed = useMemo(() => (cursor === null ? log : log.slice(0, cursor)), [log, cursor]);
  const state = useMemo(() => (cursor === null ? liveState : fold(viewed)), [cursor, liveState, viewed]);
  const ev = useMemo(() => evaluate(state), [state]);
  const pulse = useMemo(() => pulseOf(state), [state]);
  const attention = useMemo(() => attentionOf(state), [state]);

  // A room whose decision no longer exists on screen closes, so it can't reappear on its own later.
  useEffect(() => {
    if (room && !ev.decisions.some((d) => d.key === room)) setRoom(null);
  }, [room, ev]);

  const viewedRef = useRef(viewed);
  useEffect(() => {
    viewedRef.current = viewed;
  }, [viewed]);
  const actionLog = useCallback(() => viewedRef.current, []);

  /* What just happened: the engine trace and Savy's moments ----------- */
  const [trace, setTrace] = useState<EngineTrace | null>(null);
  const [traceSeq, setTraceSeq] = useState(0);
  const [moment, setMoment] = useState<SavyMoment | null>(null);
  const momentSeq = useRef(0);
  const restoring = useRef(false);
  const previous = useRef<TwinState>(liveState);
  useEffect(() => {
    const before = previous.current;
    previous.current = liveState;
    if (before === liveState) return;
    if (liveState.phase === "idle") {
      setTrace(null);
      setMoment(null);
      return;
    }
    if (restoring.current) {
      if (liveState.phase !== "processing") restoring.current = false;
      return;
    }
    if (liveState.processedThrough > before.processedThrough && (before.phase === "processing" || liveState.phase === "processing" || before.phase === "live")) {
      setTrace(traceOf(before, liveState));
      setTraceSeq((n) => n + 1);
    }
    const fresh = liveState.audit.slice(before.audit.length);
    const raise = (kind: MomentKind, keys: DecisionKey[]) => setMoment({ kind, id: ++momentSeq.current, keys });
    if (before.phase === "processing" && liveState.phase === "live") {
      raise("synthesis", evaluate(liveState).decisions.map((d) => d.key));
    } else if (liveState.phase === "live" && fresh.some((a) => a.actor === "savy" && MOVED.has(a.type))) {
      raise("transition", fresh.filter((a) => a.actor === "savy" && a.decision).map((a) => a.decision!));
    } else if (fresh.some((a) => a.type === "memory.recorded")) {
      raise("learning", []);
    }
  }, [liveState]);

  useEffect(() => {
    if (!moment) return;
    const id = window.setTimeout(() => setMoment(null), MOMENT_MS);
    return () => window.clearTimeout(id);
  }, [moment]);

  /* The night moves on its own: arrivals, Savy reading, the floor answering */
  useEffect(() => {
    if (!live) return;
    let id: number | undefined;
    if (liveState.phase === "arriving") id = window.setInterval(() => dispatch({ type: "TICK" }), pace("arrive"));
    else if (liveState.phase === "processing") id = window.setInterval(() => dispatch({ type: "TICK" }), pace("process"));
    return () => window.clearInterval(id);
  }, [liveState.phase, live, reducedMotion, dispatch]);

  const openRequest = liveState.requests.find((r) => r.answeredAt === null);
  useEffect(() => {
    if (!live || !openRequest) return;
    const id = window.setTimeout(() => dispatch({ type: "MANAGER_REPLY", item: openRequest.item }), pace("manager"));
    return () => window.clearTimeout(id);
  }, [openRequest, live, dispatch]);

  useEffect(() => {
    if (!live || liveState.submission?.status !== "unknown") return;
    const id = window.setTimeout(() => dispatch({ type: "VENDOR_RECONCILE" }), pace("vendor"));
    return () => window.clearTimeout(id);
  }, [liveState.submission?.status, live, dispatch]);

  useEffect(() => {
    if (!live || liveState.phase !== "closed") return;
    const id = window.setTimeout(() => dispatch({ type: "RECORD_MEMORY" }), pace("remember"));
    return () => window.clearTimeout(id);
  }, [liveState.phase, live, dispatch]);

  /* Links ------------------------------------------------------------ */
  const restored = useRef(false);
  useEffect(() => {
    const restore = () => {
      const link = readLink();
      if (!link) return;
      liveRef.current = true;
      restoring.current = true;
      dispatch({ type: "RESET" });
      for (const action of link.actions) dispatch(action);
      if (link.mode) setMode(link.mode);
      if (link.view) setView(link.view);
    };
    if (!restored.current) {
      restored.current = true;
      restore();
    }
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, [dispatch]);

  const goTo = useCallback((next: Mode) => {
    setMode(next);
    setRoom(null);
    window.scrollTo({ top: 0 });
  }, []);

  const openSituation = useCallback(
    (id: string | null) => {
      setFocusedSituation(id);
      if (id !== null && mode !== "lab") setMode("lab");
    },
    [mode],
  );

  const reset = useCallback(() => {
    liveRef.current = true;
    dispatch({ type: "RESET" });
    setMode("live");
    setView("operator");
    setRoom(null);
    setTheater(null);
    setPressure(false);
    setFocusedSituation(null);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.scrollTo({ top: 0 });
  }, [dispatch]);

  const openNight = useCallback(
    (scenario: ScenarioId) => {
      liveRef.current = true;
      setCursor(null);
      dispatch({ type: "OPEN", scenario });
      setMode("live");
      setRoom(null);
      setTheater(null);
      window.scrollTo({ top: 0 });
    },
    [dispatch],
  );

  const session = useMemo<Session>(
    () => ({
      log,
      cursor,
      live,
      travelTo: (next) => setCursor(next === null || next >= log.length ? null : Math.max(1, next)),
      link: () => {
        const params = [`s=${encodeSession(log)}`];
        if (mode !== "live") params.push(`m=${mode}`);
        if (view !== "operator") params.push(`v=${view}`);
        return `${window.location.origin}${window.location.pathname}#${params.join("&")}`;
      },
    }),
    [log, cursor, live, mode, view],
  );

  const value = useMemo<TwinContextValue>(
    () => ({
      state,
      ev,
      pulse,
      attention,
      dispatch,
      actionLog,
      session,
      mode,
      goTo,
      view,
      setView,
      room,
      openRoom: setRoom,
      theater,
      setTheater,
      pressure,
      setPressure,
      trace,
      traceSeq,
      moment: live ? moment : null,
      focusedSituation,
      openSituation,
      openNight,
      reset,
    }),
    [state, ev, pulse, attention, dispatch, actionLog, session, mode, goTo, view, room, theater, pressure, trace, traceSeq, moment, live, focusedSituation, openSituation, openNight, reset],
  );

  return <TwinContext.Provider value={value}>{children}</TwinContext.Provider>;
}

export function useTwin(): TwinContextValue {
  const value = useContext(TwinContext);
  if (!value) throw new Error("useTwin must be used inside <TwinProvider>");
  return value;
}
