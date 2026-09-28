/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps.

   The header is a Disclosure: badge + title row + chevron live in the toggle
   <button>; the file:line link sits in `actions` (a link inside a button is
   invalid HTML and unreachable by Tab) and wraps onto its own line under the
   title, indented past the badge column, so the card reads as before. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Disclosure,
  DisclosureChevron,
  Markdown,
  SEV,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { lineLabel } from "@/components/findings-popover";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const sevColor = SEV[f.severity].c;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const muted = accepted || dismissed;

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <Disclosure
        defaultOpen={defaultExpanded ?? false}
        headerStyle={s.header}
        header={(open) => (
          <>
            <div style={s.badgeWrap}>
              <SeverityBadge severity={f.severity} compact />
            </div>
            <div style={s.headerMain}>
              <div style={s.titleRow}>
                <span style={s.title(muted, dismissed)}>{f.title}</span>
                <CategoryTag category={f.category} />
                {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
                {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
              </div>
            </div>
            <DisclosureChevron open={open} style={s.chevron} />
          </>
        )}
        actions={
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        }
      >
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown safe>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown safe>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
