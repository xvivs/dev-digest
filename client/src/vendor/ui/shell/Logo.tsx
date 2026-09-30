import React from "react";
import { Icon } from "../icons";

/** DevDigest logo mark + wordmark. `sm` is the compact Topbar variant. */
export function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const sm = size === "sm";
  const box = sm ? 22 : 26;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: sm ? 8 : 10 }}>
      <div
        style={{
          width: box,
          height: box,
          borderRadius: 7,
          background: "var(--text-primary)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon.Layers size={sm ? 13 : 15} style={{ color: "var(--bg-primary)" }} />
      </div>
      <span style={{ fontSize: sm ? 15 : 16, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>DevDigest</span>
    </div>
  );
}
