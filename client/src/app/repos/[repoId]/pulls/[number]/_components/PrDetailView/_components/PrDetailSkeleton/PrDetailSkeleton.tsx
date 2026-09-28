"use client";

import React from "react";
import { Skeleton } from "@devdigest/ui";
import { s } from "../../styles";

/** Placeholder while the PR resolves (and the Suspense fallback for `?tab=`). */
export function PrDetailSkeleton() {
  return (
    <div style={s.skeleton} aria-busy="true">
      <Skeleton height={28} width={420} />
      <Skeleton height={16} width={300} />
      <Skeleton height={200} />
    </div>
  );
}
