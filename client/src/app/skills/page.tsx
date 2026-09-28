import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills list). Thin route entry — the view, its cards, the
   left pane, its modals and i18n are colocated under _components/SkillsListView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("skills");
  return { title: t("page.heading") };
}

export default function SkillsPage() {
  return <SkillsListView />;
}
