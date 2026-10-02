import { memoriesOf, type Memory } from "./memory";
import { evaluate, type TwinState } from "./runtime";

/** Decision memory as of this state: the seed, tonight once remembered, and what the owner taught. */
export function memoriesFor(state: TwinState): Memory[] {
  const e = evaluate(state);
  const priced = e.twin.invoices.find((i) => i.verdict === "price" || i.verdict === "both");
  return memoriesOf({
    scenario: state.scenario,
    outcome: state.outcome,
    remembered: state.phase === "remembered",
    taught: state.taught,
    counted: state.requests
      .filter((r) => r.place === "backup" && r.answeredAt !== null)
      .map((r) => ({ item: e.scenario.items[r.item]?.name ?? r.item, covered: e.twin.inventory.find((i) => i.item === r.item)?.status === "ok" })),
    invoiceOverPct: priced ? priced.deltaPct : null,
    plannedCovers: e.scenario.plan.covers,
  });
}
