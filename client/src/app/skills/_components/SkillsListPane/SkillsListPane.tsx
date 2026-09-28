/* SkillsListPane — the left column shared by the bare /skills route and the
   /skills/:id editor (SPEC-02 AC-1, AC-2, AC-4): search, "Add Skill" menu
   (Create / Import from file) and the filtered card list. A route-ancestor
   component (ADR 0010) so both /skills and its [id] child can import it
   through the barrel without promoting it out of app/skills/. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon, TextInput } from "@devdigest/ui";
import type { SkillListItem } from "@devdigest/shared";
import { skillEditorHref } from "../../helpers";
import { SkillCard } from "../SkillCard";
import { ADD_MENU_WIDTH, SEARCH_ICON_SIZE, SKELETON_CARD_COUNT, SKELETON_CARD_HEIGHT } from "./constants";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListPane({
  skills,
  isLoading,
  isError,
  onRetry,
  activeId,
  tab,
  onCreateClick,
  onImportClick,
}: {
  skills: SkillListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** The skill whose card should render as current (the /:id editor only). */
  activeId?: string;
  /** Carried into each card's href so switching skills keeps the open tab. */
  tab?: string;
  onCreateClick: () => void;
  onImportClick: () => void;
}) {
  const t = useTranslations("skills");
  const [search, setSearch] = React.useState("");
  const list = filterSkills(skills ?? [], search);

  return (
    <div style={s.pane}>
      <div style={s.header}>
        <div style={s.titleRow}>
          <h2 style={s.title}>{t("page.heading")}</h2>
          <Dropdown
            width={ADD_MENU_WIDTH}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.create"), icon: "Edit", onClick: onCreateClick },
              { divider: true },
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: onImportClick },
            ]}
          />
        </div>
        <TextInput
          type="search"
          value={search}
          onChange={setSearch}
          placeholder={t("page.searchPlaceholder")}
          aria-label={t("page.searchLabel")}
          suffix={<Icon.Search size={SEARCH_ICON_SIZE} style={s.searchIcon} />}
        />
      </div>
      <div style={s.body}>
        {isLoading &&
          Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
            <Skeleton key={i} height={SKELETON_CARD_HEIGHT} style={s.skeletonGap} />
          ))}
        {isError && <ErrorState body={t("page.loadError")} onRetry={onRetry} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={onCreateClick}
          />
        )}
        {list.map((sk) => (
          <SkillCard key={sk.id} skill={sk} active={sk.id === activeId} href={skillEditorHref(sk.id, tab)} />
        ))}
      </div>
    </div>
  );
}
