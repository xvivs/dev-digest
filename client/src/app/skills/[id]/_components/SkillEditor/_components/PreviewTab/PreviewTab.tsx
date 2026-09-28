/* PreviewTab — the skill editor's Preview tab (SPEC-02 AC-10). The
   Rendered/Source view itself is `SkillBodyPreview`, shared with the import
   drawer's preview step at the `/skills` ancestor route (ADR 0010) — see
   its header comment for why the shared piece lives there and not here. */
"use client";

import { SkillBodyPreview } from "@/app/skills/_components/SkillBodyPreview";

export function PreviewTab({ body }: { body: string }) {
  return <SkillBodyPreview body={body} />;
}
