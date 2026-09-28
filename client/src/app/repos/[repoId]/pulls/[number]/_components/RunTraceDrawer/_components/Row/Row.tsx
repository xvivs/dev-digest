/* Row — a fixed-width label followed by its value, in the Configuration section. */
import React from "react";
import { s } from "../../styles";

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {children}
    </div>
  );
}
