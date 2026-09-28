/* SkillBodyPreview — "Rendered as the reviewing agent receives it" (SPEC-02
   AC-10, AC-22). Rendered mode uses Markdown's `safe` hardening (images as
   links, links open in a new tab — ADR 0012's untrusted-inputs list). Source
   mode shows the raw body with invisible/bidi characters marked and an
   HTML-comment warning, since rendered markdown hides both.

   Lives at the `/skills` ancestor route (ADR 0010) because it has two
   consumers on different route segments: the skill editor's Preview tab
   (`/skills/[id]`, via the thin `PreviewTab` wrapper) and the import drawer's
   preview step (`/skills`, `ImportSkillDrawer`). An ancestor may not import a
   descendant's `_components/`, so the shared piece sits at the ancestor
   instead of staying inside `SkillEditor/_components/PreviewTab`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs, Markdown } from "@devdigest/ui";
import { hasHtmlComment, hasInvisibleChars, splitInvisibleChars } from "@/app/skills/helpers";
import { DEFAULT_PREVIEW_MODE, PREVIEW_MODES, type PreviewMode } from "./constants";
import { s } from "./styles";

export function SkillBodyPreview({ body }: { body: string }) {
  const t = useTranslations("skills");
  const [mode, setMode] = React.useState<PreviewMode>(DEFAULT_PREVIEW_MODE);

  const tabs = PREVIEW_MODES.map((m) => ({ key: m, label: t(`preview.${m}`) }));
  const segments = React.useMemo(() => splitInvisibleChars(body), [body]);
  const commented = hasHtmlComment(body);
  const invisible = hasInvisibleChars(body);

  return (
    <div>
      <div style={s.caption}>{t("preview.caption")}</div>
      <div style={s.modeBar}>
        <Tabs tabs={tabs} value={mode} onChange={(k) => setMode(k as PreviewMode)} pad="0" />
      </div>
      {mode === "source" && commented && <div style={s.warning}>{t("preview.commentWarning")}</div>}
      {mode === "source" && invisible && <div style={s.warning}>{t("preview.invisibleWarning")}</div>}
      {mode === "rendered" ? (
        <div style={s.rendered}>
          <Markdown safe>{body}</Markdown>
        </div>
      ) : (
        <pre className="mono" style={s.source}>
          {segments.map((seg, i) =>
            seg.invisibleLabel ? (
              <mark key={i} style={s.invisibleMark} title={seg.invisibleLabel}>
                [{seg.invisibleLabel}]
              </mark>
            ) : (
              <React.Fragment key={i}>{seg.text}</React.Fragment>
            ),
          )}
        </pre>
      )}
    </div>
  );
}
