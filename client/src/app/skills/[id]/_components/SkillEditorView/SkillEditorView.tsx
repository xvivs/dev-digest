/* SkillEditorView — the /skills/:id screen: the shared SkillsListPane (left)
   plus the tabbed editor for the selected skill (right). Tab state lives in
   ?tab= (reads useSearchParams, so the route renders it inside a local
   <Suspense>). Owns the dirty-form navigation guard (SPEC-02 AC-8): the
   Config tab reports its dirty flag; card links, tab switches and the "Add"
   menu all route through it before they navigate away. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, ErrorState, Skeleton, Icon, Badge } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills, useSkill } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { SKILLS_HREF } from "@/app/skills/constants";
import { skillEditorHref } from "@/app/skills/helpers";
import { NavigationGuardContext, type NavigationGuard } from "@/app/skills/navigation-guard";
import { SkillsListPane } from "@/app/skills/_components/SkillsListPane";
import { CreateSkillModal } from "@/app/skills/_components/CreateSkillModal";
import { ImportSkillDrawer } from "@/app/skills/_components/ImportSkillDrawer";
import { SkillEditor } from "../SkillEditor";
import { DIRTY_GUARD_MODAL_WIDTH, FROM_VERSION_PARAM, HEADER_ICON_SIZE, SKELETON_BODY_HEIGHT, SKELETON_TITLE } from "./constants";
import { editorQuery, parseFromVersion, resolveTab } from "./helpers";
import { s } from "./styles";

export function SkillEditorView({ id }: { id: string }) {
  const t = useTranslations("skills");
  const search = useSearchParams();
  const router = useRouter();

  const { data: skills, isLoading: skillsLoading, isError: skillsError, refetch: refetchSkills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const tab = resolveTab(search.get("tab"));
  const fromVersion = tab === "config" ? parseFromVersion(search.get(FROM_VERSION_PARAM)) : null;
  const navigate = (next: string, version: number | null = null) =>
    router.replace(`${SKILLS_HREF}/${encodeURIComponent(id)}?${editorQuery(search.toString(), next, version)}`);
  // Not guarded here — SkillEditor's Tabs already route every change through
  // `guard.confirmNavigation` before calling this. Any tab change drops
  // `fromVersion`, so the restore draft seeds Config once.
  const setTab = (next: string) => navigate(next);
  // Restore popup → "Edit": Config opens vN as an unsaved draft (ADR 0016).
  const editFromVersion = (version: number) => navigate("config", version);
  // After the draft is saved it is the current version; drop the seed.
  const clearFromVersion = () => navigate("config");

  // A mutable ref, not state: the Config tab reports every keystroke's dirty
  // flag, and a `dirty` re-render of this whole screen per keystroke would be
  // wasteful. Only `pendingProceed` (a real user-facing decision) is state.
  const dirtyRef = React.useRef(false);
  const [pendingProceed, setPendingProceed] = React.useState<(() => void) | null>(null);
  const guard = React.useMemo<NavigationGuard>(
    () => ({
      setDirty: (v: boolean) => {
        dirtyRef.current = v;
      },
      confirmNavigation: (proceed: () => void) => {
        if (!dirtyRef.current) {
          proceed();
          return;
        }
        setPendingProceed(() => proceed);
      },
    }),
    [],
  );
  const discardAndProceed = () => {
    const proceed = pendingProceed;
    dirtyRef.current = false;
    setPendingProceed(null);
    proceed?.();
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: SKILLS_HREF },
    { label: skill?.name ?? t("detail.skillFallback") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.loadError")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <NavigationGuardContext.Provider value={guard}>
        {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
        {importing && <ImportSkillDrawer onClose={() => setImporting(false)} />}
        <div style={s.layout}>
          <SkillsListPane
            skills={skills}
            isLoading={skillsLoading}
            isError={skillsError}
            onRetry={() => refetchSkills()}
            activeId={id}
            tab={tab}
            onCreateClick={() => guard.confirmNavigation(() => setCreating(true))}
            onImportClick={() => guard.confirmNavigation(() => setImporting(true))}
          />

          {isLoading || !skill ? (
            <div style={s.loading}>
              <Skeleton height={SKELETON_TITLE.height} width={SKELETON_TITLE.width} />
              <Skeleton height={SKELETON_BODY_HEIGHT} />
            </div>
          ) : (
            <div style={s.editor}>
              <div style={s.editorHeader}>
                <Icon.Sparkles size={HEADER_ICON_SIZE} style={s.editorIcon} />
                <h1 className="mono" style={s.editorTitle}>
                  {skill.name}
                </h1>
                <Badge color="var(--text-secondary)">{t(`type.${skill.type}`)}</Badge>
                <Badge color="var(--text-secondary)" mono>
                  v{skill.version}
                </Badge>
                {!skill.enabled && <Badge color="var(--text-muted)">{t("detail.disabled")}</Badge>}
                {skill.needs_vetting && (
                  <span title={t("card.vettingTitle")}>
                    <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                      {t("card.needsVetting")}
                    </Badge>
                  </span>
                )}
                <div style={s.editorActions}>
                  <Button kind="secondary" size="sm" icon="FlaskConical" disabled title={t("detail.runOnEvalsHint")}>
                    {t("detail.runOnEvals")}
                  </Button>
                </div>
              </div>
              <div style={s.editorBody}>
                <SkillEditor
                  key={skill.id}
                  skill={skill}
                  tab={tab}
                  onTab={setTab}
                  fromVersion={fromVersion}
                  onEditVersion={editFromVersion}
                  onDraftSaved={clearFromVersion}
                />
              </div>
            </div>
          )}
        </div>
      </NavigationGuardContext.Provider>

      {pendingProceed && <DirtyGuardModal onDiscard={discardAndProceed} onCancel={() => setPendingProceed(null)} />}
    </AppShell>
  );
}

/** "Discard changes?" confirm (AC-8). */
function DirtyGuardModal({ onDiscard, onCancel }: { onDiscard: () => void; onCancel: () => void }) {
  const t = useTranslations("skills");
  const tShell = useTranslations("shell");
  return (
    <Modal
      width={DIRTY_GUARD_MODAL_WIDTH}
      title={t("config.dirtyGuard.title")}
      closeLabel={tShell("ui.close")}
      onClose={onCancel}
      footer={
        <div style={s.dirtyGuardFooter}>
          <Button kind="ghost" onClick={onCancel}>
            {t("config.dirtyGuard.cancel")}
          </Button>
          <Button kind="danger" onClick={onDiscard}>
            {t("config.dirtyGuard.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.dirtyGuardBody}>{t("config.dirtyGuard.body")}</div>
    </Modal>
  );
}
