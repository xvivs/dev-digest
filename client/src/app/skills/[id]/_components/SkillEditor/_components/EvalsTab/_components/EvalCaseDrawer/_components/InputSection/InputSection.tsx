/* InputSection — where the case's diff came from (PR # and files, or pasted)
   and a collapsible mono preview of the stored diff (the server sends the
   first characters only). */
"use client";

import React from "react";
import type { CSSProperties } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Disclosure, DisclosureChevron } from "@devdigest/ui";
import type { EvalCaseDetailCase } from "@devdigest/shared";
import { Section } from "../Section";

const line: CSSProperties = { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 13, marginBottom: 8 };
const files: CSSProperties = { listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: 12 };
const toggle: CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" };
const pre: CSSProperties = { margin: "8px 0 0", padding: "12px 14px", fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)", background: "var(--code-bg)", borderRadius: 6, whiteSpace: "pre-wrap", overflow: "auto", maxHeight: 320 };
const muted: CSSProperties = { fontSize: 12, color: "var(--text-muted)", marginTop: 6 };

export function InputSection({ c }: { c: EvalCaseDetailCase }) {
  const t = useTranslations("eval");
  const format = useFormatter();
  const src = c.input_source;
  const source =
    src?.kind === "pr"
      ? src.pr_number != null
        ? t("drawer.input.pr", { number: src.pr_number })
        : t("drawer.input.prUnknown")
      : t("drawer.input.pasted");
  return (
    <Section title={t("drawer.input.title")}>
      <div style={line}>
        <strong>{source}</strong>
        <span style={{ color: "var(--text-muted)" }}>{t("drawer.input.files", { count: c.input_files.length })}</span>
      </div>
      {c.input_files.length > 0 && (
        <ul style={files}>
          {c.input_files.map((f) => (
            <li key={f} className="mono">
              {f}
            </li>
          ))}
        </ul>
      )}
      {c.input_diff_preview ? (
        <Disclosure header={(open) => (
          <span style={toggle}>
            <DisclosureChevron open={open} />
            {open ? t("drawer.input.diffHide") : t("drawer.input.diffShow")}
          </span>
        )}>
          <pre className="mono" style={pre}>
            {c.input_diff_preview}
          </pre>
          {c.input_diff_truncated && (
            <div style={muted}>
              {t("drawer.input.truncated", { shown: format.number(c.input_diff_preview.length), total: format.number(c.input_diff_chars) })}
            </div>
          )}
        </Disclosure>
      ) : (
        <span style={muted}>{t("drawer.input.empty")}</span>
      )}
    </Section>
  );
}
