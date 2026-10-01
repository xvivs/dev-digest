/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. The
   header is a Disclosure button (keyboard + aria-expanded); the body mounts
   only while open. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Disclosure, Icon } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, partitionByKey, type Line, type RevealTarget } from "../helpers";
import { findingKey, isActiveFinding, lineMarks, type DiffFindingApi } from "../findings";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";
import { UnmatchedFindings } from "../UnmatchedFindings";

const NO_FINDINGS: readonly FindingRecord[] = [];

/** Findings whose card hangs under a parsed line (RIGHT key only). */
function findingsForLine(ln: Line, matched: Map<string, FindingRecord[]>): FindingRecord[] {
  if (matched.size === 0 || (ln.kind !== "add" && ln.kind !== "ctx") || ln.newNo == null) return [];
  return matched.get(`RIGHT:${ln.newNo}`) ?? [];
}

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  findingApi,
  defaultOpen,
  reveal,
  onRevealConsumed,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findingApi?: DiffFindingApi;
  /** Replaces the AUTO_EXPAND_MAX_LINES heuristic when given. */
  defaultOpen?: boolean;
  /** A request addressed to some file; acts only when `path` is this one. */
  reveal?: RevealTarget | null;
  /** Called once this card has opened and scrolled to `reveal`; the owner should drop it. */
  onRevealConsumed?: (reveal: RevealTarget) => void;
}) {
  const t = useTranslations("diffViewer");
  const [open, setOpen] = React.useState(
    defaultOpen ?? (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES,
  );
  const rootRef = React.useRef<HTMLDivElement>(null);
  // Open on a new request for this file. Adjusting state during render (not in
  // an effect) so a card mounted by an opening group is already open.
  const [seen, setSeen] = React.useState<RevealTarget | null>(null);
  const revealed = reveal && reveal.path === file.path ? reveal : null;
  if (revealed && revealed !== seen) {
    setSeen(revealed);
    setOpen(true);
  }
  // Scroll once the body is in the DOM: to the line when the patch shows it, else to the file.
  const scrolled = React.useRef<RevealTarget | null>(null);
  React.useEffect(() => {
    if (!revealed || !open || scrolled.current === revealed) return;
    scrolled.current = revealed;
    const root = rootRef.current;
    if (!root) return;
    const lineEl =
      revealed.line != null ? root.querySelector(`[data-new-line="${revealed.line}"]`) : null;
    (lineEl ?? root).scrollIntoView({ block: lineEl ? "center" : "start" });
    onRevealConsumed?.(revealed);
  }, [revealed, open, onRevealConsumed]);
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  // Findings of this file (dismissed ones still render, muted): those on a
  // rendered RIGHT line hang under it, the rest go to the end-of-file block.
  const allFindings = findingApi?.findings;
  const fileFindings = React.useMemo(
    () => (allFindings ?? NO_FINDINGS).filter((f) => f.file === file.path),
    [allFindings, file.path],
  );
  const { matchedFindings, unmatchedFindings, marks } = React.useMemo(() => {
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    const { matched, unmatched } = partitionByKey(fileFindings, findingKey, renderedKeys);
    return {
      matchedFindings: matched,
      unmatchedFindings: unmatched,
      marks: lineMarks(lines, fileFindings),
    };
  }, [fileFindings, lines]);
  const activeFindingCount = fileFindings.filter(isActiveFinding).length;

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div ref={rootRef} style={s.fileRoot}>
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        style={s.fileCard}
        header={
          <span style={s.fileHeader}>
            <Icon.ChevronRight size={13} style={chevronFor(open)} aria-hidden="true" />
            <Icon.FileText size={14} style={s.fileIcon} aria-hidden="true" />
            <span className="mono" style={s.filePath}>
              {file.path}
            </span>
            {activeFindingCount > 0 && (
              <span
                role="img"
                style={s.findingDot}
                title={t("findingsDot", { count: activeFindingCount })}
                aria-label={t("findingsDot", { count: activeFindingCount })}
              />
            )}
            <span style={s.statCluster}>
              {commentCount > 0 && (
                <span style={s.commentCount} title={t("commentCount", { count: commentCount })}>
                  <Icon.MessageSquare size={12} aria-hidden="true" />
                  {commentCount}
                </span>
              )}
              <span className="mono tnum" style={s.fileStat}>
                <span style={s.addText}>+{file.additions}</span>{" "}
                <span style={s.delText}>−{file.deletions}</span>
              </span>
            </span>
          </span>
        }
      >
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                mark={marks.get(`RIGHT:${ln.newNo}`)}
                findings={findingsForLine(ln, matchedFindings)}
                findingApi={findingApi}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
          {findingApi && findingApi.show && (
            <UnmatchedFindings findings={unmatchedFindings} api={findingApi} />
          )}
        </div>
      </Disclosure>
    </div>
  );
}
