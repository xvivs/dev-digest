/* NotIndexedState — the "repo is not indexed / not cloned" empty state (AC-32).
   Presentational: the parent owns the mutations and passes ready-made messages. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import { notIndexedView } from "./helpers";
import { s } from "./styles";

export interface NotIndexedStateProps {
  notCloned: boolean;
  cloning: boolean;
  indexing: boolean;
  /** Message of the failed clone request, or null. */
  cloneError: string | null;
  /** Message of the failed resync request, or null. */
  indexError: string | null;
  onClone: () => void;
  onIndex: () => void;
}

export function NotIndexedState({
  notCloned,
  cloning,
  indexing,
  cloneError,
  indexError,
  onClone,
  onIndex,
}: NotIndexedStateProps) {
  const t = useTranslations("conventions.states.notIndexed");
  const view = notIndexedView({ notCloned, cloning, indexing });
  const error = notCloned ? cloneError : indexError;
  return (
    <EmptyState
      icon="Database"
      title={t("title")}
      body={
        <>
          {t(view.bodyKey)}
          {error && (
            <div role="alert" style={s.inlineError}>
              <strong>{t(view.errorTitleKey)}</strong> {error}
            </div>
          )}
        </>
      }
      cta={t(view.ctaKey)}
      onCta={notCloned ? onClone : onIndex}
      ctaLoading={view.ctaLoading}
    />
  );
}
