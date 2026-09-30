/* Conventions — /repos/:repoId/conventions. Thin route: resolves params and the
   page title; the screen lives in ConventionsView. */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ConventionsView } from "./_components/ConventionsView";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("conventions");
  return { title: t("page.metaTitle") };
}

export default async function ConventionsPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return <ConventionsView repoId={repoId} />;
}
