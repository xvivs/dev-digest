"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks";
import { notify } from "@/lib/toast";

/** This call site reports its own failure with GitHub-specific copy, so the
 *  global mutation toast stays silent for it (docs/adr/0011). Module-level so
 *  the options object is stable. */
const LOCAL_ERROR = { meta: { errorSurface: "local" } } as const;

export interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId, LOCAL_ERROR);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
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

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {t(showComments ? "diff.hideComments" : "diff.showComments", { count: commentCount })}
            </Button>
          ) : undefined
        }
      >
        {t("diff.title", { count: filesCount })}
      </SectionLabel>
      <DiffViewer files={files} commenting={commenting} />
    </section>
  );
}
