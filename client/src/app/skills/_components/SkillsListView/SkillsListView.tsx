/* /skills — Skills list (SPEC-02 AC-1..AC-4). Two-pane layout: SkillsListPane
   on the left (shared with the /skills/:id editor, ADR 0010), a "select a
   skill" prompt on the right since nothing is selected at this route. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useSkills } from "@/lib/hooks";
import { SkillsListPane } from "../SkillsListPane";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      {importing &&
        // Seam for the import stream (owns app/skills/_components/ImportSkillDrawer/**):
        // mount <ImportSkillDrawer onClose={() => setImporting(false)} /> here.
        null}
      <div style={s.layout}>
        <SkillsListPane
          skills={skills}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          onCreateClick={() => setCreating(true)}
          onImportClick={() => setImporting(true)}
        />
        <div style={s.content}>
          <EmptyState icon="Sparkles" title={t("page.selectPrompt.title")} body={t("page.selectPrompt.body")} />
        </div>
      </div>
    </AppShell>
  );
}
