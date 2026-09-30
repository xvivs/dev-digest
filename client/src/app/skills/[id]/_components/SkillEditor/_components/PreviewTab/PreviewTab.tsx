/* PreviewTab — the skill editor's Preview tab (SPEC-02 AC-10). The
   Rendered/Source view itself is `SkillBodyPreview`, shared with the import
   drawer's preview step at the `/skills` ancestor route (ADR 0010) — see
   its header comment for why the shared piece lives there and not here. The
   section title is this tab's own: the drawer already titles its step. */
"use client";

import { useTranslations } from "next-intl";
import { SkillBodyPreview } from "@/components/skill-body-preview";
import { s } from "./styles";

export function PreviewTab({ body }: { body: string }) {
  const t = useTranslations("skills");
  return (
    <section aria-labelledby="skill-preview-title">
      <h2 id="skill-preview-title" style={s.title}>
        {t("preview.title")}
      </h2>
      <SkillBodyPreview body={body} />
    </section>
  );
}
