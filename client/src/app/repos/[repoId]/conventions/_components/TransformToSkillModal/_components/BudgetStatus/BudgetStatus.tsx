/* BudgetStatus — the body's size against the room each attached agent has left
   of its 24 KB skills budget (AC-44, V15). Without it the limit surfaced only as
   a 422 after submit. The remaining room is computed exactly the way the server
   counts it (enabled links to enabled skills, UTF-8 bytes). */
"use client";

import { useTranslations } from "next-intl";
import { formatBytes, type AgentBudget } from "../../../../helpers";
import { s } from "./styles";

export function BudgetStatus({
  bodyBytes,
  agentIds,
  budgets,
  agentNames,
  pending,
}: {
  bodyBytes: number;
  agentIds: readonly string[];
  /** Budgets for the agents whose links have loaded. */
  budgets: readonly AgentBudget[];
  agentNames: ReadonlyMap<string, string>;
  /** Some attached agent's links are still loading. */
  pending: boolean;
}) {
  const t = useTranslations("conventions");
  const known = new Set(budgets.map((b) => b.agentId));
  const missing = !pending && agentIds.some((id) => !known.has(id));

  return (
    <div style={s.wrap}>
      <div style={s.title}>{t("modal.budget.title")}</div>
      <div className="tnum">{t("modal.budget.size", { size: formatBytes(bodyBytes) })}</div>
      {pending && <div style={s.muted}>{t("modal.budget.loading")}</div>}
      <ul style={s.list}>
        {budgets.map((b) => {
          const name = agentNames.get(b.agentId) ?? b.agentId;
          const values = { name, remaining: formatBytes(b.remaining) };
          return (
            <li key={b.agentId} className="tnum" style={s.line(b.over)}>
              {t(b.over ? "modal.budget.over" : "modal.budget.line", values)}
            </li>
          );
        })}
      </ul>
      {missing && <div style={s.muted}>{t("modal.budget.unknownRemaining")}</div>}
    </div>
  );
}
