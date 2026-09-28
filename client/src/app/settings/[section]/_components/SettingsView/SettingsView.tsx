/* Settings — left sub-nav + sections. API Keys (OpenRouter + GitHub PAT, with
   Test connection) and Feature Models. Section is deep-linked at
   /settings/:section. */
"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, SETTINGS_SECTIONS } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { SettingsApiKeys } from "./_components/SettingsApiKeys";
import { SettingsModels } from "./_components/SettingsModels";
import { DEFAULT_SECTION, SECTION_API_KEYS, SECTION_MODELS, SETTINGS_HOME_HREF } from "./constants";
import { s } from "./styles";

export function SettingsView() {
  const t = useTranslations("settings");
  const params = useParams<{ section: string }>();
  const section = params.section ?? DEFAULT_SECTION;
  const current = SETTINGS_SECTIONS.find((sec) => sec.key === section) ?? SETTINGS_SECTIONS[0];
  // Section labels come from `settings.sections.<key>`, not the English
  // `label` on the design-system data (ADR D6).
  const currentLabel = t(`sections.${current.key}`);

  return (
    <AppShell crumb={[{ label: t("breadcrumb"), href: SETTINGS_HOME_HREF }, { label: currentLabel }]}>
      <div style={s.layout}>
        <div style={s.nav}>
          <h1 style={s.navTitle}>{t("title")}</h1>
          {SETTINGS_SECTIONS.map((sec) => {
            const on = sec.key === section;
            return (
              <Link key={sec.key} href={`/settings/${sec.key}`} aria-current={on ? "page" : undefined}>
                <div style={s.navItem(on)}>{t(`sections.${sec.key}`)}</div>
              </Link>
            );
          })}
        </div>
        <div style={s.pane}>
          {section === SECTION_API_KEYS ? (
            <SettingsApiKeys />
          ) : section === SECTION_MODELS ? (
            <SettingsModels />
          ) : (
            <EmptyState
              icon="Settings"
              title={currentLabel}
              body={t("fallbackBody", { label: currentLabel })}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
