/* PromptModalBody — fullscreen modal body for a prompt block: monospace text +
   a line search. Fixed height so the modal stays stable even when the search
   finds nothing. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { TextInput } from "@devdigest/ui";
import { s } from "../../styles";

/** Highlight every case-insensitive occurrence of `q` within a single line. */
function highlightLine(line: string, q: string): React.ReactNode {
  if (!q) return line;
  const lower = line.toLowerCase();
  const ql = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i <= line.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(line.slice(i));
      break;
    }
    if (idx > i) parts.push(line.slice(i, idx));
    parts.push(
      <mark key={idx} style={s.modalMark}>
        {line.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  return parts;
}

export function PromptModalBody({ text }: { text: string }) {
  const t = useTranslations("runs");
  const [q, setQ] = React.useState("");
  const shownText = text || t("trace.empty");
  const lines = React.useMemo(() => shownText.split("\n"), [shownText]);
  const ql = q.trim().toLowerCase();
  const shown = ql ? lines.filter((l) => l.toLowerCase().includes(ql)) : lines;
  return (
    <div style={s.modalBody}>
      <div style={s.modalSearch}>
        <TextInput
          value={q}
          onChange={setQ}
          placeholder={t("trace.prompt.search")}
          suffix={
            ql ? (
              <span style={s.modalMatchCount}>
                {t("trace.prompt.matchCount", {
                  shown: String(shown.length),
                  total: String(lines.length),
                })}
              </span>
            ) : undefined
          }
        />
      </div>
      <div style={s.modalScroll}>
        {ql && shown.length === 0 ? (
          <div style={s.modalNoMatches}>{t("trace.prompt.noMatches", { q: q.trim() })}</div>
        ) : (
          <pre className="mono" style={s.modalPre}>
            {ql ? shown.map((l, i) => <div key={i}>{highlightLine(l, q)}</div>) : shownText}
          </pre>
        )}
      </div>
    </div>
  );
}
