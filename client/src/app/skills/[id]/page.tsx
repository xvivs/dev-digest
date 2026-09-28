import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { SkillEditorView } from "./_components/SkillEditorView";

/* Route: /skills/:id (Skill Editor). Thin Server Component: resolves the id and
   renders the client view. The local <Suspense> is the boundary for the view's
   useSearchParams (?tab=). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("skills");
  return { title: t("detail.metaTitle") };
}

export default async function SkillEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <SkillEditorView id={id} />
    </Suspense>
  );
}
