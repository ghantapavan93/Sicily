import {
  CalendarClock,
  CircleDollarSign,
  EyeOff,
  FastForward,
  GitFork,
  History,
  ListChecks,
  type LucideIcon,
  Package,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { VENUE } from "@/domain/venue";
import type { Pulse } from "@/twin/pulse";
import type { Evaluation, TwinState } from "@/twin/runtime";

export interface Prompt {
  id: string;
  label: string;
  question: string;
  hint: string;
  icon: LucideIcon;
}

/** Questions an owner actually asks at 5:40 on a Friday. Savy answers each from the same twin the screen shows. */
export const OWNER_QUESTIONS: Prompt[] = [
  { id: "attention", label: "What needs my attention?", question: "What needs my attention?", hint: "The decisions, the missing fact, and what can wait", icon: TriangleAlert },
  { id: "afford", label: "Can I afford the extra server?", question: "Can I afford the extra server?", hint: "Wages, labor against your goal, weekly cash", icon: CircleDollarSign },
  { id: "nothing", label: "What if I do nothing?", question: "What if I do nothing?", hint: "The rest of tonight, run forward both ways", icon: FastForward },
  { id: "wait", label: "What can wait until Monday?", question: "What can wait until Monday?", hint: "Ranked by when it matters, not how loud it is", icon: CalendarClock },
];

export const QUICK_ACTIONS: Prompt[] = [
  { id: "burrata", label: "Why worry about burrata?", question: "Why are you worried about burrata?", hint: "", icon: Package },
  { id: "drop", label: "What if 20 cancel?", question: "What if reservations drop by 20?", hint: "", icon: GitFork },
  { id: "changed", label: "What changed today?", question: "What changed since this morning?", hint: "", icon: ListChecks },
  { id: "hidden", label: "What did you hide?", question: "What did you hide from me?", hint: "", icon: EyeOff },
  { id: "proof", label: "Check my history", question: "Would you have been right before?", hint: "", icon: History },
  { id: "memory", label: "What you've learned", question: `What have you learned about ${VENUE.name}?`, hint: "", icon: Sparkles },
];

export interface Command {
  command: string;
  description: string;
  question: string;
}

/** Typed with a leading slash in the composer. Each one is a question Savy answers through its tools. */
export const COMMANDS: Command[] = [
  { command: "/brief", description: "What needs you before service", question: "What needs my attention?" },
  { command: "/afford", description: "Can the night carry the extra server?", question: "Can I afford the extra server?" },
  { command: "/nothing", description: "Run the night forward with no change", question: "What if I do nothing?" },
  { command: "/fork-covers", description: "Fork: 20 fewer covers", question: "What if reservations drop by 20?" },
  { command: "/fork-oncall", description: "Fork: the on-call server can't come", question: "What if Sam says no?" },
  { command: "/fork-pos", description: "Dry run: the POS stops syncing", question: "What if the POS goes down?" },
  { command: "/wait", description: "What can wait until Monday", question: "What can wait until Monday?" },
  { command: "/hidden", description: "What Savy kept out of your way", question: "What did you hide from me?" },
  { command: "/floor", description: "Explain it like I'm on the floor", question: "Explain it like I'm on the floor" },
  { command: "/engineer", description: "Explain it for an engineer", question: "Explain it for an engineer" },
  { command: "/order", description: "Tomorrow's draft order", question: "What's going into tomorrow's order?" },
  { command: "/invoice", description: "Price change or volume?", question: "Is the produce invoice a price change?" },
  { command: "/cash", description: "This week's cash, and tonight's effect on it", question: "How is cash looking this week?" },
  { command: "/proof", description: "The last 30 services", question: "Would you have been right before?" },
  { command: "/memory", description: `What Savy has learned about ${VENUE.name}`, question: `What have you learned about ${VENUE.name}?` },
  { command: "/approve", description: "Put the staffing approval in front of you", question: "Go ahead and approve it" },
];

/** A short line under the greeting that says where the night stands: the Daily Pulse, in Savy's voice. */
export function situationLine(state: TwinState, pulse: Pulse): string {
  if (state.phase === "arriving" || state.phase === "waiting") return "Signals are arriving. I haven't read them yet.";
  if (state.phase === "processing") return "I'm reading what arrived, in order.";
  if (pulse.tone === "changed") return `Tonight changed. ${pulse.sub.replace("Your original service plan is no longer the plan I would use. ", "")}`;
  return `${pulse.headline} ${pulse.sub}`;
}

/** Follow-up questions offered above the composer, chosen by what is open tonight. */
export function followUpsFor(state: TwinState, ev: Evaluation): string[] {
  if (state.phase === "closed" || state.phase === "remembered") return ["How did tonight turn out?", `What have you learned about ${VENUE.name}?`, "Would you have been right before?"];
  const out: string[] = [];
  const open = (key: string) => ev.decisions.find((d) => d.key === key);
  if (ev.decisions.some((d) => d.remedies.some((r) => r.kind === "ask_manager"))) out.push("Ask the manager to check stock");
  if (ev.decisions.some((d) => d.remedies.some((r) => r.kind === "recheck_pos"))) out.push("Re-check the POS");
  if (open("staffing")?.status === "recommend") out.push("Can I afford the extra server?");
  out.push("What if I do nothing?", "What can wait until Monday?", "Explain it like I'm on the floor");
  return out.slice(0, 4);
}
