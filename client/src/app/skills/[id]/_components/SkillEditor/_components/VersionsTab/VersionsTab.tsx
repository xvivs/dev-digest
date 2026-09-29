/* VersionsTab — the skill's version history (ADR 0016): newest first, the
 * current version badged, lost history shown as "vN body unavailable". Each
 * older snapshot row expands an inline diff and offers the Restore
 * confirmation; the current row shows only its pill. The tab holds no draft of its own, so it never has to
 * report dirty state to the navigation guard. */
"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkill, useSkillVersions } from "@/lib/hooks";
import { RestoreVersionModal } from "./_components/RestoreVersionModal";
import { DIFF_SKELETON_HEIGHT, SKELETON_ROWS, SKELETON_ROW_HEIGHT } from "./constants";
import { buildVersionRows, type VersionRow } from "./helpers";
import { s } from "./styles";

// Loaded on first "Diff" click: keeps jsdiff out of the editor's first load.
const VersionDiff = dynamic(() => import("./_components/VersionDiff").then((m) => m.VersionDiff), {
  ssr: false,
  loading: () => <Skeleton height={DIFF_SKELETON_HEIGHT} />,
});

export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const versions = useSkillVersions(skill.id);
  const { refetch: refetchSkill } = useSkill(skill.id);
  const [openDiff, setOpenDiff] = React.useState<number | null>(null);
  const [restoring, setRestoring] = React.useState<number | null>(null);

  const reload = () => {
    void refetchSkill();
    void versions.refetch();
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.title}>{t("versions.title")}</h2>
        <Badge style={s.count}>{t("versions.count", { count: skill.version })}</Badge>
      </div>
      <p style={s.caption}>{t("versions.caption")}</p>

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
            <li
              key={row.version}
              style={row.kind === "snapshot" && row.isCurrent ? { ...s.item, ...s.itemCurrent } : s.item}
            >
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
      <span className="mono" style={s.badge}>
        {t("versions.label", { version })}
      </span>
      <div style={s.rowMain}>
        <span style={s.gap}>{t("versions.unavailable")}</span>
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
        <span className="mono" style={isCurrent ? { ...s.badge, ...s.badgeCurrent } : s.badge}>
          {t("versions.label", { version })}
        </span>
        <div style={s.rowMain}>
          {summary.change_note ? (
            <span style={s.note} title={summary.change_note}>
              {summary.change_note}
            </span>
          ) : (
            <span style={s.noNote}>{t("versions.noNote")}</span>
          )}
          <time dateTime={summary.created_at} style={s.when}>
            {summary.created_at.slice(0, 10)}
          </time>
        </div>
        <div style={s.actions}>
          {isCurrent && (
            <Badge dot color="var(--ok)" bg="var(--ok-bg)" style={s.pill}>
              {t("versions.current")}
            </Badge>
          )}
          {!isCurrent && (
            <>
              <Button
                kind="ghost"
                size="sm"
                icon="Eye"
                style={s.button}
                aria-expanded={diffOpen}
                aria-controls={diffId}
                onClick={onToggleDiff}
              >
                {diffOpen ? t("versions.hideDiff") : t("versions.showDiff")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="History"
                style={s.button}
                aria-label={t("versions.restoreAria", { version })}
                onClick={onRestore}
              >
                {t("versions.restore")}
              </Button>
            </>
          )}
        </div>
      </div>
      {diffOpen && !isCurrent && <VersionDiff id={diffId} skill={skill} version={version} hasPrevSnapshot={row.hasPrevSnapshot} />}
    </>
  );
}
