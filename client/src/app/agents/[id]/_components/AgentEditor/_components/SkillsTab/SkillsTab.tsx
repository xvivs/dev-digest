/* SkillsTab — attach/detach/reorder workspace skills for one agent (SPEC-02).
   Every workspace skill is listed (linked first, by order; then the rest by
   name — helpers.buildSkillRows). Ticking, unticking, dragging or using ↑/↓
   autosaves: the full `AgentSkillLink[]` is held in a ref and, 400ms after the
   last change, sent as ONE `PUT /agents/:id/skills`. The query cache IS the
   render source (no parallel local draft to keep in sync): every action
   writes `["agent-skills", agentId]` optimistically so the row list updates
   instantly, and a `confirmedRef` (updated only by a successful save) is what
   an error rolls back to — never "whatever was in the cache one edit ago",
   which would just restore the very state that failed.

   Render with `key={agent.id}` from AgentEditor (same reason as ConfigTab):
   switching agents must flush this instance's pending save on unmount, not
   carry its refs into a new agent's tab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { TextInput, Icon } from "@devdigest/ui";
import type { Agent, AgentSkillLink, SkillListItem } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { AUTOSAVE_DEBOUNCE_MS } from "./constants";
import {
  buildSkillRows,
  countEnabledSkills,
  filterSkillRows,
  moveLink,
  reorderLinkByDrag,
  toPayloadLinks,
  toggleLink,
} from "./helpers";
import { SkillRow } from "./_components/SkillRow";
import { s } from "./styles";

const EMPTY_SKILLS: readonly SkillListItem[] = [];
const EMPTY_LINKS: readonly AgentSkillLink[] = [];
/** Stable meta object (ADR 0011): this tab shows its own inline error, so the
 *  global mutation-error toast stays silent for it. */
const LOCAL_ERROR = { meta: { errorSurface: "local" as const } };

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const qc = useQueryClient();
  const { data: skills = EMPTY_SKILLS } = useSkills();
  const { data: links = EMPTY_LINKS } = useAgentSkills(agent.id);
  const setAgentSkills = useSetAgentSkills(LOCAL_ERROR);

  const [filter, setFilter] = React.useState("");
  const [saveError, setSaveError] = React.useState<string | null>(null);

  // Bookkeeping refs for the debounce — never read during render.
  const latestRef = React.useRef<readonly AgentSkillLink[]>(links);
  const confirmedRef = React.useRef<readonly AgentSkillLink[]>(links);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Skill id currently being dragged; read by the row it's dropped on. */
  const dragSkillId = React.useRef<string | null>(null);

  // Whenever nothing is queued AND no save is in flight, the query's own data
  // IS the confirmed baseline — keep the rollback target current. Written
  // after commit, not during render (component purity). `isPending` matters
  // here: without it, a commit that happens WHILE a save is outstanding would
  // "confirm" its own not-yet-acked optimistic write, leaving nothing correct
  // to roll back to on failure.
  const isSaving = setAgentSkills.isPending;
  React.useEffect(() => {
    if (!debounceRef.current && !isSaving) confirmedRef.current = links;
  }, [links, isSaving]);

  // Plain function, not useCallback: it's never a memo-child prop or another
  // hook's dependency (the unmount effect below reads it through a ref
  // instead), so memoizing it would buy nothing (react-best-practices).
  //
  // No staleness check is needed here for onSuccess/onError: TanStack Query's
  // MutationObserver only ever invokes a PER-CALL `mutate(vars, options)`
  // callback for whichever dispatch it currently tracks (the latest one) — an
  // older, superseded dispatch's onSuccess/onError below simply never fires.
  // (The hook's OWN unconditional onSuccess does not get this filtering for
  // free, which is why useSetAgentSkills carries its own generation guard.)
  function flush() {
    // Cancel the queued timer too: the unmount effect can call this early,
    // and a still-armed timeout would then send a second PUT.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    const toSave = latestRef.current;
    setAgentSkills.mutate(
      { agentId: agent.id, links: toPayloadLinks(toSave) },
      {
        onSuccess: (data) => {
          confirmedRef.current = data;
          latestRef.current = data;
          qc.setQueryData(["agent-skills", agent.id], data);
        },
        onError: (err) => {
          latestRef.current = confirmedRef.current;
          qc.setQueryData(["agent-skills", agent.id], confirmedRef.current);
          setSaveError(errorMessage(err, t("skills.saveError")));
        },
      },
    );
  }

  const queueChange = (next: AgentSkillLink[]) => {
    latestRef.current = next;
    qc.setQueryData(["agent-skills", agent.id], next);
    setSaveError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  };

  // Flush a pending save when this tab goes away — agent switch (this
  // component is keyed by agent.id, so switching remounts it) or navigating
  // off the page entirely (SPEC-02 AC-16).
  const flushRef = React.useRef(flush);
  React.useLayoutEffect(() => {
    flushRef.current = flush;
  });
  React.useEffect(
    () => () => {
      if (debounceRef.current) flushRef.current();
    },
    [],
  );

  const rows = buildSkillRows(skills, links);
  const visibleRows = filterSkillRows(rows, filter);
  const { enabled, total } = countEnabledSkills(rows);
  const lastLinkedOrder = links.length - 1;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: enabled, total })}</span>
        <div style={s.filter}>
          <TextInput
            type="search"
            value={filter}
            onChange={setFilter}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            suffix={<Icon.Search size={14} />}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>
      <p style={s.hint}>{t("skills.autosaveHint")}</p>

      {saveError && (
        <div role="alert" style={s.saveError}>
          {saveError}
        </div>
      )}

      <div style={s.list}>
        {visibleRows.length === 0 ? (
          <div style={s.empty}>{t("skills.noMatches")}</div>
        ) : (
          visibleRows.map((row) => (
            <SkillRow
              key={row.skill.id}
              row={row}
              isFirstLinked={row.order === 0}
              isLastLinked={row.order === lastLinkedOrder}
              onToggle={(checked) => queueChange(toggleLink(links, agent.id, row.skill.id, checked))}
              onMove={(direction) => queueChange(moveLink(links, row.skill.id, direction))}
              onDragStart={() => {
                dragSkillId.current = row.skill.id;
              }}
              onDrop={() => {
                const draggedId = dragSkillId.current;
                dragSkillId.current = null;
                if (!draggedId) return;
                queueChange(reorderLinkByDrag(links, draggedId, row.skill.id));
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
