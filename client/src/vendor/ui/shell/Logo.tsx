import React from "react";
import { Icon } from "../icons";

/**
 * DevDigest logo mark + wordmark. `sm` is the compact Topbar variant. Spans
 * only, so it is valid inside a <button> or <a>. The mark carries `dd-logo-mark`
 * and `data-logo-mark` so a `dd-logo-trigger` ancestor can spin it and the
 * Topbar can read its centre.
 */
export function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const sm = size === "sm";
  const box = sm ? 22 : 26;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: sm ? 8 : 10 }}>
      <span
        className="dd-logo-mark"
        data-logo-mark=""
        style={{
          width: box,
          height: box,
          borderRadius: 7,
          background: "var(--text-primary)",
          display: "inline-grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon.Layers size={sm ? 13 : 15} style={{ color: "var(--bg-primary)" }} />
      </span>
      <span style={{ fontSize: sm ? 15 : 16, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>DevDigest</span>
    </span>
  );
}
