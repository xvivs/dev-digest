/* ConventionCard — one candidate on the Conventions page (AC-33, AC-35..AC-40):
   rule, category, badges, verified evidence, confidence, Accept / Reject
   (aria-pressed), a selection checkbox on the Accepted tab, inline edit, and a
   confirm before rejecting a convention that is already in a skill. The card
   holds only UI state (editing, confirming); every decision goes up through
   `onDecide` / `onEdit` so the optimistic update lives in one place. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, IconBtn, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate, ConventionCategory, ConventionStatus } from "@devdigest/shared";
import { skillHref } from "@/lib/routes";
import { confidencePct, confidenceTone } from "../../helpers";
import { TONE_COLOR } from "./constants";
import { EvidenceBlock } from "./_components/EvidenceBlock";
import { RejectConfirmModal } from "./_components/RejectConfirmModal";
import { RuleEditor } from "./_components/RuleEditor";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoFullName,
  selectable,
  selected,
  onSelectedChange,
  onDecide,
  onEdit,
}: {
  candidate: ConventionCandidate;
  /** `owner/repo`, for evidence links; null until the repo list has loaded. */
  repoFullName: string | null;
  /** Checkboxes exist only on the Accepted tab (D8). */
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (id: string, selected: boolean) => void;
  onDecide: (id: string, status: ConventionStatus) => void;
  onEdit: (id: string, next: { rule: string; category: ConventionCategory }) => void;
}) {
  const t = useTranslations("conventions");
  const [editing, setEditing] = React.useState(false);
  const [confirmingReject, setConfirmingReject] = React.useState(false);

  const pct = confidencePct(candidate.confidence);
  const tone = TONE_COLOR[confidenceTone(candidate.confidence)];
  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";

  const onAccept = () => onDecide(candidate.id, accepted ? "pending" : "accepted");
  const onReject = () => {
    if (rejected) return onDecide(candidate.id, "pending");
    // A skill snapshot keeps the rule (AC-38): say so before the decision lands.
    if (candidate.skills.length > 0) return setConfirmingReject(true);
    onDecide(candidate.id, "rejected");
  };

  return (
    <>
      <article style={s.card(tone)} aria-label={candidate.rule}>
        <div style={s.main}>
          <div style={s.titleRow}>
            {selectable && (
              <Checkbox
                checked={selected}
                onChange={(v) => onSelectedChange(candidate.id, v)}
                aria-label={candidate.rule}
              />
            )}
            {!editing && (
              <>
                <h3 style={s.rule}>{candidate.rule}</h3>
                <IconBtn icon="Edit" label={t("card.edit")} size={26} onClick={() => setEditing(true)} />
              </>
            )}
          </div>
          {editing && (
            <RuleEditor
              rule={candidate.rule}
              category={candidate.category}
              onSave={(next) => {
                setEditing(false);
                onEdit(candidate.id, next);
              }}
              onCancel={() => setEditing(false)}
            />
          )}
          <div style={s.badges}>
            <Badge>{t(`card.category.${candidate.category}`)}</Badge>
            {candidate.edited && <Badge color="var(--accent-text)" bg="var(--accent-bg)">{t("card.badges.edited")}</Badge>}
            {candidate.skills.map((skill) => (
              <Link key={skill.id} href={skillHref(skill.id)} style={s.skillBadgeLink}>
                <Badge color="var(--ok)" bg="var(--ok-bg)" mono>
                  {t("card.badges.inSkill", { name: skill.name })}
                </Badge>
              </Link>
            ))}
            {!candidate.seen_in_latest && (
              <Badge color="var(--warn)" bg="var(--warn-bg)">
                {t("card.badges.notSeen")}
              </Badge>
            )}
            {candidate.review_hits > 0 && <Badge>{t("card.badges.flagged", { count: candidate.review_hits })}</Badge>}
            <Badge>{t("card.badges.cited", { count: candidate.evidence.length })}</Badge>
          </div>
          <div style={s.evidenceList}>
            {candidate.evidence.map((ev) => (
              <EvidenceBlock
                key={`${ev.path}:${ev.line_start}-${ev.line_end}`}
                evidence={ev}
                repoFullName={repoFullName}
                sha={candidate.last_seen_commit_sha}
              />
            ))}
          </div>
          <div style={s.confidenceRow}>
            <span>{t("card.confidence")}</span>
            <div style={s.confidenceBar} aria-hidden>
              <ProgressBar value={pct} color={tone} />
            </div>
            <span className="tnum" style={s.pct}>
              {pct}%
            </span>
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind={accepted ? "primary" : "secondary"}
            icon="Check"
            full
            aria-pressed={accepted}
            onClick={onAccept}
          >
            {accepted ? t("card.accepted") : t("card.accept")}
          </Button>
          <Button kind={rejected ? "danger" : "ghost"} icon="X" full aria-pressed={rejected} onClick={onReject}>
            {rejected ? t("card.rejected") : t("card.reject")}
          </Button>
        </div>
      </article>
      {confirmingReject && (
        <RejectConfirmModal
          skills={candidate.skills}
          onCancel={() => setConfirmingReject(false)}
          onConfirm={() => {
            setConfirmingReject(false);
            onDecide(candidate.id, "rejected");
          }}
        />
      )}
    </>
  );
}
