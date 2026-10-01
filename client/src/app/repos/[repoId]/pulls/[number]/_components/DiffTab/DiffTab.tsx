"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import {
  DiffViewer,
  isActiveFinding,
  type DiffCommentApi,
  type DiffFindingApi,
  type RevealTarget,
  UnmatchedFindings,
} from "@/components/diff-viewer";
import {
  usePrComments,
  useCreatePrComment,
  usePrReviews,
  usePrSmartDiff,
  useFindingAction,
} from "@/lib/hooks";
import { notify } from "@/lib/toast";
import type { OrderMode } from "./constants";
import {
  countFilesWithFindings,
  groupFilesByRole,
  selectDiffFindings,
  summarize,
  toggleLabel,
  unmatchedFileFindings,
  collapsedPathsFor,
} from "./helpers";
import { s } from "./styles";
import { DiffFindingCard, DiffNavContext, type DiffNav } from "./_components/DiffFindingCard";
import { OrderToggle } from "./_components/OrderToggle";
import { SmartDiffGroup } from "./_components/SmartDiffGroup";

/** This call site reports its own failure with GitHub-specific copy, so the
 *  global mutation toast stays silent for it (docs/adr/0011). Module-level so
 *  the options object is stable. */
const LOCAL_ERROR = { meta: { errorSurface: "local" } } as const;

export interface DiffTabProps {
  prId: string | null;
  /** Keys the smart-diff query, so a head move re-groups. */
  headSha: string;
  files: PrFile[];
  /** `owner/repo`; lets finding paths outside the diff link to GitHub. */
  repoFullName?: string | null;
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, headSha, files, repoFullName, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const { data: reviews } = usePrReviews(prId);
  const smartDiff = usePrSmartDiff(prId, headSha);
  const create = useCreatePrComment(prId, LOCAL_ERROR);
  const findingAction = useFindingAction();
  // One toggle for GitHub comments AND agent findings. `null` = untouched:
  // comments stay hidden (clean diff), findings stay shown.
  const [showOverride, setShowOverride] = React.useState<boolean | null>(null);
  const [mode, setMode] = React.useState<OrderMode>("smart");

  // The last "open this file" request from a finding card; a new object per
  // click so repeating the same path scrolls again.
  const [reveal, setReveal] = React.useState<RevealTarget | null>(null);
  // One-shot: the card that acted on a request clears it, so remounting cards
  // (group re-expand, Smart <-> Original) does not replay it.
  const consumeReveal = React.useCallback(
    (done: RevealTarget) => setReveal((cur) => (cur === done ? null : cur)),
    [],
  );
  const nav = React.useMemo<DiffNav>(
    () => ({
      paths: new Set(files.map((f) => f.path)),
      openFile: (path, line) => setReveal({ path, line }),
      repoFullName: repoFullName ?? null,
      headSha,
    }),
    [files, repoFullName, headSha],
  );

  const findings = React.useMemo(() => selectDiffFindings(reviews ?? []), [reviews]);
  const activeFindingCount = findings.filter(isActiveFinding).length;
  const hasReviews = (reviews?.length ?? 0) > 0;

  const groups = React.useMemo(
    () => (smartDiff.data ? groupFilesByRole(files, smartDiff.data) : null),
    [files, smartDiff.data],
  );
  const collapsedPaths = React.useMemo(() => collapsedPathsFor(groups ?? []), [groups]);
  const groupingFailed = smartDiff.isError;
  const activeMode: OrderMode = groupingFailed ? "original" : mode;
  const grouped = activeMode === "smart" && groups !== null;

  const commentCount = comments?.length ?? 0;
  const toggle = toggleLabel(showOverride, {
    commentCount,
    findingCount: findings.length,
    activeFindingCount,
  });

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments: showOverride ?? false,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowOverride(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(
          err instanceof Error && err.message
            ? t("diff.commentFailedReason", { reason: err.message })
            : t("diff.commentFailed"),
        );
        throw err;
      }
    },
  };

  const findingApi: DiffFindingApi = {
    findings,
    show: showOverride ?? true,
    Card: DiffFindingCard,
    // prId in the variables is what makes the ["reviews", prId] refetch happen.
    onAction: (finding, action) =>
      findingAction.mutate({ findingId: finding.id, action, ...(prId ? { prId } : {}) }),
    pendingId: findingAction.isPending ? (findingAction.variables?.findingId ?? null) : null,
  };

  // Smart order keeps docs/boilerplate collapsed; Original order behaves like
  // GitHub (only the viewer's size heuristic applies).
  const defaultOpenFor = (path: string) => (collapsedPaths.has(path) ? false : undefined);
  const stray = unmatchedFileFindings(files, findings);
  const totals = summarize(files);

  return (
    <DiffNavContext value={nav}>
      <section>
        <SectionLabel
          icon="Code"
          right={
            toggle.visible ? (
              <Button
                kind="ghost"
                size="sm"
                icon={toggle.next ? "Eye" : "EyeOff"}
                onClick={() => setShowOverride(toggle.next)}
              >
                {t(`diff.${toggle.key}`, { count: toggle.count })}
              </Button>
            ) : undefined
          }
        >
          {t("smartDiff.groupedByRole")}
        </SectionLabel>

        <div style={s.headerRow}>
          <span style={s.summary}>
            {t("smartDiff.summaryFiles", { count: totals.count })}{" "}
            <span className="mono" style={s.add}>
              +{totals.additions}
            </span>{" "}
            <span className="mono" style={s.del}>
              −{totals.deletions}
            </span>
          </span>
          {reviews && reviews.length === 0 && <span style={s.summary}>{t("smartDiff.reviewNotRun")}</span>}
          <OrderToggle mode={activeMode} onChange={setMode} smartDisabled={groupingFailed} />
        </div>
        {groupingFailed && <div style={s.note}>{t("smartDiff.groupingFailed")}</div>}

        {grouped ? (
          groups.map((g) => (
            <SmartDiffGroup
              key={g.role}
              group={g}
              filesWithFindings={hasReviews ? countFilesWithFindings(g.files, findings) : null}
              reveal={reveal && g.files.some((f) => f.path === reveal.path) ? reveal : null}
            >
              <DiffViewer
                files={g.files}
                commenting={commenting}
                findings={findingApi}
                defaultOpenFor={defaultOpenFor}
                reveal={reveal}
                onRevealConsumed={consumeReveal}
              />
            </SmartDiffGroup>
          ))
        ) : (
          <DiffViewer
            files={files}
            commenting={commenting}
            findings={findingApi}
            reveal={reveal}
            onRevealConsumed={consumeReveal}
          />
        )}

        {findingApi.show && (
          <UnmatchedFindings
            findings={stray}
            api={findingApi}
            variant="standalone"
            title={t("smartDiff.unmatchedFilesTitle", { count: stray.length })}
          />
        )}
      </section>
    </DiffNavContext>
  );
}
