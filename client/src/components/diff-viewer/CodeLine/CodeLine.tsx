/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, the finding stripe + start-line label, any anchored
   comment threads and finding cards, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi } from "../comments";
import { SEVERITY_LINE_LABEL_KEY } from "../constants";
import type { DiffFindingApi, LineMark } from "../findings";
import type { Line } from "../helpers";
import { s, cs, lineRowFor, lineSignFor, lineStripeFor, lineLabelFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  mark,
  findings,
  findingApi,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Stripe (and start-line label) for this line, from an active finding. */
  mark?: LineMark;
  /** Findings whose card hangs under this line. */
  findings?: FindingRecord[];
  findingApi?: DiffFindingApi;
}) {
  const t = useTranslations("diffViewer");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const sev = mark ? SEV[mark.severity] : null;
  const SevIcon = sev ? Icon[sev.icon] : null;
  const Card = findingApi?.Card;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind)}>
        {mark && sev && <span title={mark.title} style={lineStripeFor(sev.c)} />}
        <span className="mono tnum" style={s.lineNo}>
          {showAdd && target && (
            <button
              type="button"
              title={t("addComment")}
              aria-label={t("addComment")}
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {mark?.isStart && sev && SevIcon && (
          <span style={lineLabelFor(sev.c)}>
            <SevIcon size={11} aria-hidden="true" />
            {t(`finding.${SEVERITY_LINE_LABEL_KEY[mark.severity]}`)}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {findingApi && Card && findingApi.show && findings && findings.length > 0 && (
        <div style={cs.thread}>
          {findings.map((f) => (
            <Card
              key={f.id}
              finding={f}
              onAction={(action) => findingApi.onAction(f, action)}
              pending={findingApi.pendingId === f.id}
            />
          ))}
        </div>
      )}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
