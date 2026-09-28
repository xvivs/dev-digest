/* RouteError — the body of every App Router error boundary (app/error.tsx and
   segment-level error.tsx files). Shows what broke, a retry that calls the
   boundary's `reset`, and a link home. Renders no AppShell: a segment boundary
   that wants the shell wraps it itself, so a crash inside the shell cannot
   loop back into this boundary. */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { HOME_HREF } from "./constants";
import { s } from "./styles";

/** The props Next passes to an `error.tsx` default export. */
export type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export function RouteError({ error, reset }: RouteErrorProps) {
  const t = useTranslations("common.boundaries.error");
  return (
    <div role="alert" style={s.root}>
      <div style={s.badge} aria-hidden>
        <Icon.AlertOctagon size={22} />
      </div>
      <h1 style={s.title}>{t("title")}</h1>
      <p style={s.body}>{t("body")}</p>
      {/* In production Next replaces a Server Component error's message with a
          generic one and keeps only `digest`; client errors keep their message. */}
      {error.message && <pre style={s.message}>{error.message}</pre>}
      {error.digest && <p style={s.digest}>{t("digest", { digest: error.digest })}</p>}
      <div style={s.actions}>
        <Button kind="primary" icon="RefreshCw" onClick={() => reset()}>
          {t("retry")}
        </Button>
        <Link href={HOME_HREF} style={s.homeLink}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}

export default RouteError;
