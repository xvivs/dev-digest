"use client";

import React from "react";
import type { CSSProperties } from "react";

const wrap: CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, marginBottom: 14, background: "var(--bg-elevated)", overflow: "hidden" };
const head: CSSProperties = { fontSize: 14, fontWeight: 600, margin: 0, padding: "12px 16px" };
const body: CSSProperties = { borderTop: "1px solid var(--border)", padding: 16 };

/** A titled, bordered block of the case drawer (a named region for screen readers). */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} style={wrap}>
      <h3 id={id} style={head}>
        {title}
      </h3>
      <div style={body}>{children}</div>
    </section>
  );
}
