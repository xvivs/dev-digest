/* VersionsTab — the skill's version history (ADR 0016): newest first, the
 * current version badged, lost history shown as "vN body unavailable". Each
 * snapshot row expands an inline diff and offers the Restore popup (Edit /
 * Restore / Cancel). The tab holds no draft of its own, so it never has to
 * report dirty state to the navigation guard. */
"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkill, useSkillVersions } from "@/lib/hooks";
import { LocalTime } from "@/components/local-time";
import { RestoreVersionModal } from "./_components/RestoreVersionModal";
import { DIFF_SKELETON_HEIGHT, SKELETON_ROWS, SKELETON_ROW_HEIGHT } from "./constants";
import { buildVersionRows, type VersionRow } from "./helpers";
import { s } from "./styles";

// Loaded on first "Diff" click: keeps jsdiff out of the editor's first load.
const VersionDiff = dynamic(() => import("./_components/VersionDiff").then((m) => m.VersionDiff), {
  ssr: false,
  loading: () => <Skeleton height={DIFF_SKELETON_HEIGHT} />,
});

export function VersionsTab({ skill, onEditVersion }: { skill: Skill; onEditVersion: (version: number) => void }) {
  const t = useTranslations("skills");
  const versions = useSkillVersions(skill.id);
  const { refetch: refetchSkill } = useSkill(skill.id);
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);
  const [restoring, setRestoring] = React.useState<number | null>(null);

  const reload = () => {
    void refetchSkill();
    void versions.refetch();
  };

  const edit = (version: number) => {
    setRestoring(null);
    onEditVersion(version);
  };

  return (
    <div style={s.wrap}>
      <div>
        <h2 style={s.title}>{t("versions.title")}</h2>
        <p style={s.caption}>{t("versions.caption")}</p>
      </div>

      {versions.isLoading ? (
        <div style={s.skeleton}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} height={SKELETON_ROW_HEIGHT} />
          ))}
        </div>
      ) : versions.isError || !versions.data ? (
        <ErrorState title={t("versions.loadError")} onRetry={() => versions.refetch()} />
      ) : (
        <ol aria-label={t("versions.listLabel")} style={s.list}>
          {buildVersionRows(versions.data, skill.version).map((row) => (
            <li key={row.version} style={s.item}>
              {row.kind === "gap" ? (
                <GapRow version={row.version} />
              ) : (
                <SnapshotRow
                  skill={skill}
                  row={row}
                  diffOpen={openDiff === row.version}
                  onToggleDiff={() => setOpenDiff((v) => (v === row.version ? null : row.version))}
                  onRestore={() => setRestoring(row.version)}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {restoring !== null && (
        <RestoreVersionModal
          skill={skill}
          version={restoring}
          onEdit={edit}
          onClose={() => setRestoring(null)}
          onReload={reload}
        />
      )}
    </div>
  );
}

function GapRow({ version }: { version: number }) {
  const t = useTranslations("skills");
  return (
    <div style={s.row}>
      <div style={s.rowMain}>
        <span style={s.gap}>{t("versions.unavailable", { version })}</span>
        <span style={s.gapHint}>{t("versions.unavailableHint")}</span>
      </div>
    </div>
  );
}

function SnapshotRow({
  skill,
  row,
  diffOpen,
  onToggleDiff,
  onRestore,
}: {
  skill: Skill;
  row: Extract<VersionRow, { kind: "snapshot" }>;
  diffOpen: boolean;
  onToggleDiff: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("skills");
  const diffId = React.useId();
  const { version, summary, isCurrent } = row;
  return (
    <>
      <div style={s.row}>
        <div style={s.rowMain}>
          <div style={s.rowTop}>
            <Badge mono>{t("versions.label", { version })}</Badge>
            {isCurrent && (
              <Badge color="var(--accent)" bg="var(--accent-bg)">
                {t("versions.current")}
              </Badge>
            )}
            <LocalTime iso={summary.created_at} style={s.when} />
          </div>
          {summary.change_note ? (
            <span style={s.note} title={summary.change_note}>
              {summary.change_note}
            </span>
          ) : (
            <span style={s.noNote}>{t("versions.noNote")}</span>
          )}
        </div>
        <div style={s.actions}>
          <Button kind="ghost" size="sm" icon="Code" aria-expanded={diffOpen} aria-controls={diffId} onClick={onToggleDiff}>
            {diffOpen ? t("versions.hideDiff") : t("versions.showDiff")}
          </Button>
          {!isCurrent && (
            <Button kind="secondary" size="sm" icon="History" aria-label={t("versions.restoreAria", { version })} onClick={onRestore}>
              {t("versions.restore")}
            </Button>
          )}
        </div>
      </div>
      {diffOpen && <VersionDiff id={diffId} skill={skill} version={version} hasPrevSnapshot={row.hasPrevSnapshot} />}
    </>
  );
}
