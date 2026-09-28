/* PR list — /repos/:repoId/pulls. Thin route: resolves params and the page
   title; the screen lives in PullsListView. PullsListView reads
   useSearchParams, so it gets its own <Suspense> here instead of relying on
   the root boundary in app/layout.tsx. */
import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PullsListView } from "./_components/PullsListView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("prReview");
  return { title: t("list.title") };
}

export default async function PullsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return (
    <Suspense fallback={null}>
      <PullsListView repoId={repoId} />
    </Suspense>
  );
}
