/* AddRepoView — add-repository screen body. URL only. API keys (OpenAI /
   Anthropic / GitHub PAT) are NOT entered here; they live in Settings → API
   Keys and don't change per repo. Escapable: Esc or the close button returns
   to the app. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn, Kbd, TextInput, FormField } from "@devdigest/ui";
import { useAddRepo } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { repoPullsHref } from "@/lib/routes";
import { API_KEYS_HREF, CLOSE_HREF } from "./constants";
import { s } from "./styles";

export function AddRepoView() {
  const t = useTranslations("addRepo");
  const router = useRouter();
  const [repoUrl, setRepoUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // The failure renders inline under the URL field, so the global mutation
  // toast stays silent — one surface per failure (ADR 0011).
  const addRepo = useAddRepo({ meta: { errorSurface: "local" } });

  const close = React.useCallback(() => router.push(CLOSE_HREF), [router]);

  // Escapable (the footer advertises Esc — make it real).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const submit = async () => {
    const url = repoUrl.trim();
    if (!url) return;
    setError(null);
    try {
      const repo = await addRepo.mutateAsync(url);
      router.push(repoPullsHref(repo.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("addFailed"));
    }
  };

  return (
    <div style={s.page}>
      <div style={s.brand}>
        <div style={s.brandMark}>
          <Icon.Layers size={17} style={s.brandIcon} />
        </div>
        <span style={s.brandName}>{t("brand")}</span>
      </div>

      <div style={s.card}>
        <div style={s.close}>
          <IconBtn icon="X" label={t("close")} onClick={close} />
        </div>

        <h1 style={s.title}>{t("title")}</h1>
        <p style={s.lede}>
          {t.rich("lede", {
            link: (chunks) => (
              <Link href={API_KEYS_HREF} style={s.ledeLink}>
                {chunks}
              </Link>
            ),
          })}
        </p>

        <FormField label={t("urlLabel")} hint={t("urlHint")}>
          <TextInput
            value={repoUrl}
            onChange={setRepoUrl}
            mono
            placeholder={t("urlPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </FormField>

        {error && (
          <div role="alert" style={s.error}>
            <Icon.XCircle size={16} style={s.errorIcon} />
            <span style={s.errorText}>{error}</span>
          </div>
        )}

        <div style={s.actions}>
          <Button kind="ghost" size="md" onClick={close}>
            {t("cancel")}
          </Button>
          <div style={s.spacer} />
          <Button
            kind="primary"
            size="md"
            icon="Plus"
            onClick={() => void submit()}
            disabled={!repoUrl.trim() || addRepo.isPending}
          >
            {addRepo.isPending ? t("cloning") : t("submit")}
          </Button>
        </div>
      </div>

      <p style={s.footer}>
        <Icon.Lock size={12} />
        {t.rich("footer", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
      </p>
    </div>
  );
}
