import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AddRepoView } from "./_components/AddRepoView";

/* Add-repository route — /onboarding. Thin Server Component: exports the page
   title and renders the client screen from _components/AddRepoView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ namespace: "addRepo" });
  return { title: t("metaTitle") };
}

export default function AddRepoPage() {
  return <AddRepoView />;
}
