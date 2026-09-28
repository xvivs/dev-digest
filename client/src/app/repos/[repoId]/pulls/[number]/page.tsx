/* PR Detail — /repos/:repoId/pulls/:number. Server Component: resolves the
   route params and the tab title; the screen is the client PrDetailView. */
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PrDetailView } from "./_components/PrDetailView";

type PrDetailParams = Promise<{ repoId: string; number: string }>;

export async function generateMetadata({ params }: { params: PrDetailParams }): Promise<Metadata> {
  const { number } = await params;
  const t = await getTranslations("prReview");
  return { title: t("detail.metaTitle", { number }) };
}

export default async function PrDetailPage({ params }: { params: PrDetailParams }) {
  const { repoId, number } = await params;
  return <PrDetailView repoId={repoId} number={number} />;
}
