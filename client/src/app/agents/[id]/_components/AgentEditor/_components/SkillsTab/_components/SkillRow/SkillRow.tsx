/* SkillRow — one row of the agent Skills tab: drag handle, checkbox, name,
   type badge and ↑/↓ reorder buttons. Reordering (drag + arrows) only applies
   to LINKED rows — an unlinked row has no position to move within until it is
   ticked, so its handle/arrows render inert. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Checkbox, Badge, RowAction, Icon } from "@devdigest/ui";
import { ROW_ICON_SIZE } from "../../constants";
import type { SkillRow as SkillRowModel } from "../../helpers";
import { s } from "../../styles";

export function SkillRow({
  row,
  isFirstLinked,
  isLastLinked,
  onToggle,
  onMove,
  onDragStart,
  onDrop,
}: {
  row: SkillRowModel;
  isFirstLinked: boolean;
  isLastLinked: boolean;
  onToggle: (checked: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const t = useTranslations("agents");
  const reason = !row.skill.enabled ? "disabled" : row.skill.needs_vetting ? "needsVetting" : null;
  const draggable = row.linked;

  return (
    <div
      style={s.row(!!reason)}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? (e) => { e.preventDefault(); onDrop(); } : undefined}
    >
      <span
        draggable={draggable}
        onDragStart={draggable ? onDragStart : undefined}
        style={draggable ? s.handle : s.handleInert}
        aria-hidden="true"
      >
        <Icon.Menu size={ROW_ICON_SIZE} />
      </span>
      <Checkbox
        checked={row.enabled}
        onChange={onToggle}
        label={<span style={s.visuallyHidden}>{t("skills.toggleLabel", { name: row.skill.name })}</span>}
      />
      <span className="mono" style={s.name} title={row.skill.name}>
        {row.skill.name}
      </span>
      {reason && <span style={s.mutedNote}>{t(`skills.muted.${reason}`)}</span>}
      <Badge color="var(--text-secondary)" mono>
        {t(`skills.type.${row.skill.type}`)}
      </Badge>
      <span style={s.order}>
        <RowAction
          icon="ArrowUp"
          label={t("skills.moveUp", { name: row.skill.name })}
          size={ROW_ICON_SIZE}
          disabled={!row.linked || isFirstLinked}
          onClick={() => onMove(-1)}
        />
        <RowAction
          icon="ArrowDown"
          label={t("skills.moveDown", { name: row.skill.name })}
          size={ROW_ICON_SIZE}
          disabled={!row.linked || isLastLinked}
          onClick={() => onMove(1)}
        />
      </span>
    </div>
  );
}
