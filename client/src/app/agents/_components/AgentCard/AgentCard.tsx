/* AgentCard — model chip, skills count, enabled toggle. Stats are an A5 mount;
   we render the provider/model + skill count here.

   The whole card opens the agent: a stretched <Link> covers it. The toggle and
   the delete action sit ABOVE that link as siblings, never inside it — a button
   nested in a link is invalid HTML and gives screen readers one control with
   three meanings. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle, RowAction } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useDeleteAgent } from "@/lib/hooks";
import { CARD_ICON_SIZE, DELETE_ICON_SIZE, TOGGLE_SIZE } from "./constants";
import { modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  href,
  active,
  skillCount,
  onToggle,
}: {
  ag: Agent;
  /** Where the card navigates. Omit for a static (non-navigating) card. */
  href?: string;
  active?: boolean;
  skillCount?: number;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const color = modelColor(ag.model);
  const onDelete = () => {
    if (window.confirm(t("card.deleteConfirm", { name: ag.name }))) del.mutate(ag.id);
  };
  return (
    <div style={s.card(!!active, ag.enabled, !!href)}>
      {href && (
        <Link href={href} aria-label={ag.name} aria-current={active ? "page" : undefined} style={s.stretchedLink} />
      )}
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={CARD_ICON_SIZE} />
        </div>
        <span style={s.name}>{ag.name}</span>
        <div style={s.controls}>
          {onToggle && (
            <Toggle
              on={ag.enabled}
              onChange={onToggle}
              size={TOGGLE_SIZE}
              label={t("card.enabledToggle", { name: ag.name })}
            />
          )}
          <RowAction
            icon="Trash"
            tone="danger"
            label={t("card.delete")}
            size={DELETE_ICON_SIZE}
            busy={del.isPending}
            onClick={onDelete}
          />
        </div>
      </div>
      <div style={s.description}>{ag.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)}>
          {ag.model}
        </span>
        {skillCount != null && (
          <Badge color="var(--text-secondary)" icon="Sparkles">
            {t("card.skillCount", { count: skillCount })}
          </Badge>
        )}
      </div>
    </div>
  );
}
