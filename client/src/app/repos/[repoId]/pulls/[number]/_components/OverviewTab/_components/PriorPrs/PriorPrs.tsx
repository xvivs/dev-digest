"use client";

import React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge, Disclosure, DisclosureChevron, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { usePrHistory } from "@/lib/hooks";
import { s as shared } from "../../styles";
import { s } from "./styles";

/** Prior merged PRs touching the same files. Collapsed by default; all text is JSX text. */
export function PriorPrs({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const format = useFormatter();
  const { data, isLoading, isError, refetch } = usePrHistory(prId);

  let count = 0;
  let body: React.ReactNode;
  if (isLoading) {
    body = <Skeleton height={40} />;
  } else if (isError || !data) {
    body = <ErrorState title={t("error")} onRetry={() => refetch()} />;
  } else if (data.status === "unavailable") {
    body = (
      <div style={shared.muted}>
        {t("history.unavailable")}
        {data.reason ? ` ${t(`history.reason.${data.reason}`)}` : ""}
      </div>
    );
  } else if (data.history.length === 0) {
    body = <div style={shared.muted}>{t("noHistory")}</div>;
  } else {
    count = data.history.length;
    body = (
      <ul style={s.list}>
        {data.history.map((h) => (
          <li key={h.pr_number} style={s.row}>
            <div style={shared.row}>
              <span style={shared.mono}>#{h.pr_number}</span>
              <span style={s.title}>{h.title}</span>
            </div>
            <div style={shared.muted}>
              {h.author} · {t("history.merged", { date: format.dateTime(new Date(h.merged_at), { dateStyle: "medium" }) })}
            </div>
            {h.files_overlap.length > 0 && (
              <div style={s.overlap}>
                <Badge>{t("overlap", { count: h.files_overlap.length })}</Badge>
                {h.files_overlap.map((f) => (
                  <span key={f} style={shared.mono}>
                    {f}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section style={shared.card}>
      <Disclosure
        header={(open) => (
          <>
            <Icon.History size={14} aria-hidden="true" style={s.icon} />
            <span style={s.heading}>{t("history.title")}</span>
            {count > 0 && <Badge>{count}</Badge>}
            {data?.cached && <Badge>{t("history.cached")}</Badge>}
            <span style={s.chev}>
              <DisclosureChevron open={open} />
            </span>
          </>
        )}
      >
        <div style={s.body}>{body}</div>
      </Disclosure>
    </section>
  );
}
