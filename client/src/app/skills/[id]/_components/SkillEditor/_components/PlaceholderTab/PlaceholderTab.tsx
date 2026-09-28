/* PlaceholderTab — the shared empty state for Evals/Stats/Versions (SPEC-02
   D3, AC-11): these tabs render as a placeholder naming the lesson that
   fills them, not fake data. */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";

export function PlaceholderTab({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const t = useTranslations("skills");
  return <EmptyState icon="FlaskConical" title={t(titleKey)} body={t(bodyKey)} />;
}
