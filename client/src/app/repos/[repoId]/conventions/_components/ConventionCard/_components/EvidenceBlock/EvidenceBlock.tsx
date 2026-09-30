/* EvidenceBlock — one verified quote of a convention (AC-35): the real snippet,
   a copy button with an aria-label, and a GitHub link pinned to the commit the
   quote was verified at, so the cited lines still match after the branch moves.
   Read-only by design (D7): evidence is what makes a candidate checkable. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ConventionEvidence } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { COPIED_RESET_MS } from "./constants";
import { evidenceLocation } from "./helpers";
import { s } from "./styles";

export function EvidenceBlock({
  evidence,
  repoFullName,
  sha,
}: {
  evidence: ConventionEvidence;
  repoFullName: string | null;
  /** Commit the quote was last verified at; without it there is nothing to pin a link to. */
  sha: string | null;
}) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const location = evidenceLocation(evidence);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(evidence.snippet);
    } catch {
      return; // clipboard denied or unavailable: nothing was copied, so show no confirmation
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        {sha && repoFullName ? (
          <a
            className="mono"
            style={s.location}
            href={githubBlobUrl(repoFullName, sha, evidence.path, evidence.line_start, evidence.line_end)}
            target="_blank"
            rel="noopener noreferrer"
            title={t("card.evidence.open", { location })}
          >
            {location}
          </a>
        ) : (
          <span className="mono" style={s.location}>
            {location}
          </span>
        )}
        <button
          type="button"
          aria-label={t("card.evidence.copy", { location })}
          onClick={copy}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={s.copyBtn(hover)}
        >
          {copied ? <Icon.Check size={14} /> : <Icon.Copy size={14} />}
        </button>
        <span role="status" style={s.copied}>
          {copied ? t("card.evidence.copied") : ""}
        </span>
      </div>
      <pre className="mono" style={s.code}>
        {evidence.snippet}
      </pre>
    </div>
  );
}
