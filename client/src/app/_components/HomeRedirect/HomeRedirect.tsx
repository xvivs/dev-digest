/* HomeRedirect — the root screen. Sends the user to the first repo's PR list,
   or shows onboarding when there are no repos.

   The redirect stays in an effect on purpose: the target depends on client
   data (useRepos, TanStack Query), so it is known only after the query
   resolves in the browser. router.replace during render is a side effect in
   render; a server redirect() would need RSC data fetching, which this client
   does not use yet (frontend-architecture: "Before changing an established
   pattern"). The visible "Open …" button covers the frame before replace lands. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, Button, Skeleton } from "@devdigest/ui";
import { useRepos } from "@/lib/hooks";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { ONBOARDING_HREF, SKELETON_ROWS } from "./constants";
import { homeView } from "./helpers";
import { s } from "./styles";

export function HomeRedirect() {
  const t = useTranslations("common.home");
  const router = useRouter();
  const { data: repos, isLoading, isError } = useRepos();
  const view = homeView({ repos, isLoading, isError });
  const redirectHref = view.kind === "redirect" ? view.href : null;

  React.useEffect(() => {
    if (redirectHref) router.replace(redirectHref);
  }, [redirectHref, router]);

  return (
    <AppShell crumb={[{ label: t("crumb") }]}>
      <PageContainer title={t("title")} subtitle={t("subtitle")}>
        {view.kind === "loading" && (
          <div style={s.skeleton}>
            {SKELETON_ROWS.map((row, i) => (
              <Skeleton key={i} height={row.height} width={row.width} />
            ))}
          </div>
        )}
        {view.kind === "empty" && (
          <EmptyState
            icon="GitBranch"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("empty.cta")}
            onCta={() => router.push(ONBOARDING_HREF)}
          />
        )}
        {view.kind === "redirect" && (
          <div>
            <p style={s.redirecting}>{t("redirecting")}</p>
            <Button kind="primary" onClick={() => router.push(view.href)}>
              {t("open", { name: view.repo.full_name })}
            </Button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}

export default HomeRedirect;
