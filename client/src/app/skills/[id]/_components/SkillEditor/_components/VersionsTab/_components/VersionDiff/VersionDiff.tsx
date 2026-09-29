/* VersionDiff — inline diff of one skill version (ADR 0016 decision 8):
 * vN against vN−1 by default, or against the skill as it is now. Metadata
 * changes sit above the body diff as a field/before/after table. Every
 * changed line carries a "+"/"−" marker with an accessible name, so the
 * meaning never rests on colour alone. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { useSkillVersion } from "@/lib/hooks";
import { DIFF_SIGN, FIELD_COL_WIDTH } from "./constants";
import {
  compareAvailability,
  defaultCompareMode,
  diffBodies,
  diffStats,
  metadataChanges,
  type CompareMode,
  type DiffLine,
  type VersionMeta,
} from "./helpers";
import { lineRowFor, s, signFor, toggleFor } from "./styles";

interface Side extends VersionMeta {
  body: string;
}

export function VersionDiff({
  skill,
  version,
  hasPrevSnapshot,
  id,
}: {
  /** The skill as saved now — the "current" side. */
  skill: Skill;
  version: number;
  hasPrevSnapshot: boolean;
  /** DOM id, so the row's toggle can point `aria-controls` at this region. */
  id?: string;
}) {
  const t = useTranslations("skills");
  const avail = compareAvailability(version, skill.version, hasPrevSnapshot);
  const [mode, setMode] = React.useState<CompareMode | null>(() => defaultCompareMode(avail));

  const target = useSkillVersion(skill.id, mode ? version : null);
  const prev = useSkillVersion(skill.id, mode === "prev" ? version - 1 : null);

  const current: Side = { name: skill.name, description: skill.description, type: skill.type, body: skill.body };
  const versionLabel = (v: number) => t("versions.diff.versionLabel", { version: v });
  // Direction is always older → newer: vN−1 → vN, or vN → current.
  const pair: { from: Side; to: Side; fromLabel: string; toLabel: string } | null =
    mode === "prev" && prev.data && target.data
      ? { from: prev.data, to: target.data, fromLabel: versionLabel(version - 1), toLabel: versionLabel(version) }
      : mode === "current" && target.data
        ? {
            from: target.data,
            to: current,
            fromLabel: versionLabel(version),
            toLabel: t("versions.diff.currentLabel", { version: skill.version }),
          }
        : null;
  const loading = target.isLoading || prev.isLoading;
  const failed = target.isError || prev.isError;

  return (
    <section id={id} aria-label={t("versions.diffAria", { version })} style={s.wrap}>
      {mode === null ? (
        <div style={s.muted}>{t("versions.diff.nothingToCompare")}</div>
      ) : (
        <>
          <div style={s.toolbar}>
            <div style={s.heading}>
              {pair ? t("versions.diff.heading", { from: pair.fromLabel, to: pair.toLabel }) : null}
            </div>
            <div role="group" aria-label={t("versions.diff.compareLabel", { version })} style={s.group}>
              <CompareButton
                label={t("versions.diff.vsPrev")}
                active={mode === "prev"}
                disabledReason={
                  avail.prev
                    ? null
                    : version === 1
                      ? t("versions.diff.noPrev")
                      : t("versions.diff.prevUnavailable", { version: version - 1 })
                }
                onClick={() => setMode("prev")}
              />
              <CompareButton
                label={t("versions.diff.vsCurrent")}
                active={mode === "current"}
                disabledReason={avail.current ? null : t("versions.diff.isCurrent")}
                onClick={() => setMode("current")}
              />
            </div>
          </div>
          {failed ? (
            <div role="alert" style={s.error}>
              {t("versions.diff.loadError")}
            </div>
          ) : loading || !pair ? (
            <div style={s.muted}>{t("versions.diff.loading")}</div>
          ) : (
            <DiffBody from={pair.from} to={pair.to} />
          )}
        </>
      )}
    </section>
  );
}

function CompareButton({
  label,
  active,
  disabledReason,
  onClick,
}: {
  label: string;
  active: boolean;
  /** Non-null disables the button and becomes its tooltip. */
  disabledReason: string | null;
  onClick: () => void;
}) {
  const disabled = disabledReason !== null;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={disabledReason ?? undefined}
      onClick={onClick}
      style={toggleFor(active, disabled)}
    >
      {label}
    </button>
  );
}

function DiffBody({ from, to }: { from: Side; to: Side }) {
  const t = useTranslations("skills");
  const meta = metadataChanges(from, to);
  const lines = React.useMemo(() => diffBodies(from.body, to.body), [from.body, to.body]);
  const stats = diffStats(lines);
  const bodyChanged = stats.added + stats.removed > 0;

  return (
    <>
      {meta.length > 0 && (
        <div>
          <div style={s.sectionTitle}>{t("versions.diff.metaTitle")}</div>
          <table style={s.table}>
            <colgroup>
              <col style={{ width: FIELD_COL_WIDTH }} />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" style={s.th}>
                  {t("versions.diff.field")}
                </th>
                <th scope="col" style={s.th}>
                  {t("versions.diff.before")}
                </th>
                <th scope="col" style={s.th}>
                  {t("versions.diff.after")}
                </th>
              </tr>
            </thead>
            <tbody>
              {meta.map((c) => (
                <tr key={c.field}>
                  <th scope="row" className="mono" style={s.thField}>
                    {t(`versions.diff.fields.${c.field}`)}
                  </th>
                  <td style={{ ...s.td, ...s.tdOld }}>{c.from}</td>
                  <td style={{ ...s.td, ...s.tdNew }}>{c.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <div style={s.bodyHead}>
          <div style={s.sectionTitle}>{t("versions.diff.bodyTitle")}</div>
          {bodyChanged && <span style={s.muted}>{t("versions.diff.stats", stats)}</span>}
        </div>
        {bodyChanged ? (
          <div className="mono" style={s.lines}>
            {lines.map((ln, i) => (
              <DiffRow key={i} ln={ln} />
            ))}
          </div>
        ) : (
          <div style={s.muted}>{t("versions.diff.bodyUnchanged")}</div>
        )}
      </div>
    </>
  );
}

function DiffRow({ ln }: { ln: DiffLine }) {
  const t = useTranslations("skills");
  const markerLabel = ln.kind === "add" ? t("versions.diff.added") : ln.kind === "del" ? t("versions.diff.removed") : null;
  return (
    <div data-kind={ln.kind} style={lineRowFor(ln.kind)}>
      <span className="tnum" style={s.lineNo} aria-hidden="true">
        {ln.newNo ?? ln.oldNo}
      </span>
      {markerLabel ? (
        <span role="img" aria-label={markerLabel} style={signFor(ln.kind)}>
          {DIFF_SIGN[ln.kind]}
        </span>
      ) : (
        <span aria-hidden="true" style={signFor(ln.kind)}>
          {DIFF_SIGN.ctx}
        </span>
      )}
      <span style={s.text}>{ln.text || " "}</span>
    </div>
  );
}
