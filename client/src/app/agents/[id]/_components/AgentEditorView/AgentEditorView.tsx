/* AgentEditorView — the /agents/:id screen: left agent list + the editor for
   the selected agent. Tab state lives in ?tab= (reads useSearchParams, so the
   route renders it inside a local <Suspense>). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, ErrorState, Skeleton, Icon, Badge } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents, useAgent, useUpdateAgent } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { AGENTS_HREF } from "@/app/agents/constants";
import { agentEditorHref } from "@/app/agents/helpers";
import { AgentCard } from "@/components/agent-card";
import { AgentEditor } from "../AgentEditor";
import {
  ADD_MENU_WIDTH,
  HEADER_ICON_SIZE,
  RUN_ON_PR_HREF,
  SKELETON_BODY_HEIGHT,
  SKELETON_TITLE,
} from "./constants";
import { resolveTab, withTab } from "./helpers";
import { s } from "./styles";

export function AgentEditorView({ id }: { id: string }) {
  const t = useTranslations("agents");
  const search = useSearchParams();
  const router = useRouter();

  const { data: agents } = useAgents();
  const { data: agent, isLoading, isError, error, refetch } = useAgent(id);
  const update = useUpdateAgent();

  const tab = resolveTab(search.get("tab"));
  const setTab = (next: string) =>
    router.replace(`${AGENTS_HREF}/${encodeURIComponent(id)}?${withTab(search.toString(), next)}`);

  const crumb = [
    { label: t("list.breadcrumbLab") },
    { label: t("list.breadcrumb"), href: AGENTS_HREF },
    { label: agent?.name ?? t("editor.agentFallback") },
  ];

  if (isError || (!isLoading && !agent)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("editor.loadErrorTitle")}
          body={error instanceof ApiError ? error.message : t("editor.loadErrorBody")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.layout}>
        <div style={s.listPane}>
          <div style={s.listHeader}>
            <div style={s.listTitleRow}>
              <h2 style={s.listTitle}>{t("editor.listTitle")}</h2>
              <Dropdown
                width={ADD_MENU_WIDTH}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    {t("editor.add")}
                  </Button>
                }
                items={[
                  { label: t("editor.createFromScratch"), icon: "Edit", onClick: () => router.push(AGENTS_HREF) },
                ]}
              />
            </div>
          </div>
          <div style={s.listBody}>
            {(agents ?? []).map((a) => (
              <AgentCard
                key={a.id}
                ag={a}
                active={a.id === id}
                href={agentEditorHref(a.id, tab)}
                skillCount={a.skill_count ?? undefined}
                onToggle={(enabled) => update.mutate({ id: a.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {isLoading || !agent ? (
          <div style={s.loading}>
            <Skeleton height={SKELETON_TITLE.height} width={SKELETON_TITLE.width} />
            <Skeleton height={SKELETON_BODY_HEIGHT} />
          </div>
        ) : (
          <div style={s.editor}>
            <div style={s.editorHeader}>
              <Icon.Cpu size={HEADER_ICON_SIZE} style={s.editorIcon} />
              <h1 style={s.editorTitle}>{agent.name}</h1>
              <Badge color="var(--text-secondary)" mono>
                {agent.provider}/{agent.model}
              </Badge>
              {!agent.enabled && <Badge color="var(--text-muted)">{t("editor.disabled")}</Badge>}
              <div style={s.editorActions}>
                <Button kind="secondary" size="sm" icon="GitPullRequest" onClick={() => router.push(RUN_ON_PR_HREF)}>
                  {t("editor.runOnPr")}
                </Button>
              </div>
            </div>
            <div style={s.editorBody}>
              <AgentEditor agent={agent} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
