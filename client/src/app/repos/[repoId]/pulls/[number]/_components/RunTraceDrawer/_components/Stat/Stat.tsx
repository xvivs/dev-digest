/* Stat — one labelled stat tile in the trace's Stats section. */
import React from "react";
import { s } from "../../styles";

export function Stat({ label, val }: { label: string; val: React.ReactNode }) {
  return (
    <div style={s.stat}>
      <div style={s.statLabel}>{label}</div>
      <div className="tnum" style={s.statVal}>
        {val}
      </div>
    </div>
  );
}
