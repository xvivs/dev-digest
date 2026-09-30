/* BodyEditor — the skill body, editable or raw (AC-43, AC-44). Raw view shows
   the exact text the agent will receive, with invisible and bidirectional
   characters marked and HTML comments flagged: rendered Markdown hides both,
   and the body came from repo code (ADR 0016). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Tabs, Textarea } from "@devdigest/ui";
import { InvisibleCharSegments } from "@/components/invisible-char-segments";
import { hasHtmlComment, hasInvisibleChars, splitInvisibleChars } from "@/lib/invisible-chars";
import { estimateTokens } from "@/lib/tokens";
import { formatBytes } from "../../helpers";
import { BODY_ROWS, BODY_VIEWS, DEFAULT_BODY_VIEW, type BodyView } from "../../constants";
import { s } from "./styles";

export function BodyEditor({
  fileName,
  body,
  bytes,
  onChange,
}: {
  /** The skill name, shown as `<name>.md` like the file the body will be saved as. */
  fileName: string;
  body: string;
  /** UTF-8 size of `body`, computed once by the parent (it also feeds the budget). */
  bytes: number;
  onChange: (body: string) => void;
}) {
  const t = useTranslations("conventions");
  const [view, setView] = React.useState<BodyView>(DEFAULT_BODY_VIEW);
  const tabs = BODY_VIEWS.map((v) => ({ key: v, label: t(v === "edit" ? "modal.viewEdit" : "modal.viewRaw") }));

  return (
    <div style={s.frame}>
      <div style={s.header}>
        <span className="mono" style={s.file}>
          {fileName}.md
        </span>
        <Badge color="var(--text-secondary)">{t("modal.unsaved")}</Badge>
        <span style={s.spacer} />
        <span className="tnum" style={s.meta}>
          {t("modal.tokens", { count: estimateTokens(body) })} · {formatBytes(bytes)}
        </span>
        <Tabs
          tabs={tabs}
          value={view}
          onChange={(k) => setView(k as BodyView)}
          pad="0"
          ariaLabel={t("modal.bodyTabs")}
        />
      </div>
      {view === "edit" ? (
        <div style={s.editorWrap}>
          <Textarea aria-label={t("modal.body")} value={body} onChange={onChange} rows={BODY_ROWS} mono />
        </div>
      ) : (
        <>
          {hasHtmlComment(body) && <div style={s.warning}>{t("modal.rawCommentWarning")}</div>}
          {hasInvisibleChars(body) && <div style={s.warning}>{t("modal.rawInvisibleWarning")}</div>}
          <pre className="mono" style={s.raw}>
            <InvisibleCharSegments segments={splitInvisibleChars(body)} />
          </pre>
        </>
      )}
    </div>
  );
}
