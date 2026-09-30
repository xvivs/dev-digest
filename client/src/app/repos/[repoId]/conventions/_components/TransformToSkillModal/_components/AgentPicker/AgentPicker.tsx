/* AgentPicker — "Attach to agents" (AC-45, D11): a searchable list of the
   workspace's agents that adds to a chip row, capped at 20 (the API's
   `agent_ids` limit). The server links the skill to every chosen agent in the
   same transaction as the skill itself. */
"use client";

import { useTranslations } from "next-intl";
import { Icon, SearchableSelect } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { MAX_ATTACHED_AGENTS } from "../../constants";
import { s } from "./styles";

export function AgentPicker({
  id,
  agents,
  selectedIds,
  onChange,
}: {
  /** Id of the picker's trigger, so the field's `<label htmlFor>` names it. */
  id: string;
  agents: readonly Agent[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations("conventions");
  const byId = new Map(agents.map((a) => [a.id, a]));
  const options = agents.filter((a) => !selectedIds.includes(a.id)).map((a) => ({ value: a.id, label: a.name }));
  const full = selectedIds.length >= MAX_ATTACHED_AGENTS;

  return (
    <div>
      {selectedIds.length === 0 ? (
        <div style={s.none}>{t("modal.attachNone")}</div>
      ) : (
        <ul style={s.chips}>
          {selectedIds.map((agentId) => {
            const name = byId.get(agentId)?.name ?? agentId;
            return (
              <li key={agentId} style={s.chip}>
                {name}
                <button
                  type="button"
                  aria-label={t("modal.attachRemove", { name })}
                  onClick={() => onChange(selectedIds.filter((x) => x !== agentId))}
                  style={s.removeBtn}
                >
                  <Icon.X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!full && options.length > 0 && (
        <SearchableSelect
          id={id}
          value=""
          options={options}
          mono={false}
          placeholder={t("modal.attachPlaceholder")}
          ariaLabel={t("modal.attachAdd")}
          onChange={(agentId) => onChange([...selectedIds, agentId])}
        />
      )}
    </div>
  );
}
