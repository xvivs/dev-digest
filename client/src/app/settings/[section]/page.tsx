import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsView } from "./_components/SettingsView";

/* Route: /settings/:section. Thin Server Component: exports the page title and
   renders the client view, which owns the sub-nav, section panels, styles,
   constants and i18n under _components/SettingsView. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ namespace: "settings" });
  return { title: t("title") };
}

export default function SettingsPage() {
  return <SettingsView />;
}
