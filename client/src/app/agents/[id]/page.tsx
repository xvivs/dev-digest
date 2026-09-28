import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id (Agent Editor). Thin Server Component: resolves the id and
   renders the client view. The local <Suspense> is the boundary for the view's
   useSearchParams (?tab=). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("agents");
  return { title: t("editor.metaTitle") };
}

export default async function AgentEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <AgentEditorView id={id} />
    </Suspense>
  );
}
