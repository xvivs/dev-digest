"use client";

import React, { useId, useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button, VisuallyHidden } from "@devdigest/ui";
import type { PrepareOverviewRequest, PrOverviewReadiness } from "@devdigest/shared";
import { usePrepareOverview, usePrOverviewReadiness } from "@/lib/hooks";
import { SETTINGS_API_KEYS_HREF, TOOLTIP_TICK_MS } from "./constants";
import {
  CLICK_BODY,
  autoActionsIn,
  cloneFailureReason,
  indexTooltip,
  isPrepareDone,
  nextContinuation,
  prepareButtonState,
  type ContinuationIntent,
  type IndexTooltip,
} from "./helpers";
import { s } from "./styles";

/**
 * The Overview tab's header action (spec 06 D11-D13a): one button that starts
 * the missing clone / index / brief steps the server planned. After a click it
 * continues on its own when a poll offers a step the click could not run yet
 * (the brief is held back while a clone runs), at most once per step.
 */
export function PrepareOverview({ prId }: { prId: string }) {
  const t = useTranslations("brief");
  const format = useFormatter();
  const now = useNow({ updateInterval: TOOLTIP_TICK_MS });
  const descId = useId();
  const prepare = usePrepareOverview(prId);
  const intentRef = useRef<ContinuationIntent | null>(null);

  const send = (body: PrepareOverviewRequest, continuing: boolean) => {
    prepare.mutate(body, {
      onSuccess: (res) => {
        if (continuing && res.failed.length > 0) intentRef.current = null;
      },
      onError: () => {
        if (continuing) intentRef.current = null;
      },
    });
  };

  // Called from the readiness queryFn after each poll (an external event, not
  // render): the deliberate exception to "mutations from event handlers" (ADR 0025).
  const onReadiness = (_prev: PrOverviewReadiness | undefined, next: PrOverviewReadiness) => {
    const intent = intentRef.current;
    if (!intent) return;
    if (isPrepareDone(next)) {
      intentRef.current = null;
      return;
    }
    if (!nextContinuation(intent, next).call) return;
    // The server runs the whole plan for `{}`: every auto action in it is now fired.
    for (const a of autoActionsIn(next.actions)) intent.fired.add(a);
    send(CLICK_BODY.prepare, true);
  };

  const { data } = usePrOverviewReadiness(prId, { onReadiness });

  // Unmount (or a PR change, via `key`) ends the intent.
  useLayoutEffect(() => () => {
    intentRef.current = null;
  }, []);

  const state = prepareButtonState(data);
  const busy = state.busy || prepare.isPending;
  const tooltip = data ? tooltipText(t, indexTooltip(data, now, format)) : undefined;
  const cloneFailure = cloneFailureReason(data);
  const failed = prepare.data?.failed.length ?? 0;

  const onClick = () => {
    if (!data || !state.click) return;
    if (state.click === "prepare") {
      intentRef.current = { prId, fired: new Set(autoActionsIn(data.actions)) };
      send(CLICK_BODY.prepare, true);
    } else {
      send(CLICK_BODY.updateIndex, false);
    }
  };

  return (
    <div style={s.root}>
      {failed > 0 && <span style={s.note}>{t("prepare.failedSome")}</span>}
      {cloneFailure && <span style={s.note}>{t(`prepare.cloneFailed.${cloneFailure}`)}</span>}
      {data?.blocked_by === "provider_not_configured" && (
        <Link href={SETTINGS_API_KEYS_HREF} style={s.link}>
          {t("prepare.openSettings")}
        </Link>
      )}
      {tooltip && (
        <span id={descId}>
          <VisuallyHidden>{tooltip}</VisuallyHidden>
        </span>
      )}
      <Button
        kind="secondary"
        size="sm"
        icon="Sparkles"
        loading={busy}
        disabled={!state.enabled || busy}
        title={tooltip}
        aria-describedby={tooltip ? descId : undefined}
        onClick={onClick}
      >
        {t(`prepare.${busy ? "preparing" : state.label}`)}
      </Button>
    </div>
  );
}

function tooltipText(t: ReturnType<typeof useTranslations>, tip: IndexTooltip): string {
  switch (tip.key) {
    case "flagOff":
      return t("prepare.tooltip.flagOff");
    case "never":
      return t("prepare.tooltip.never");
    case "partial":
      return t("prepare.tooltip.partial", {
        reason: t(`prepare.partialReason.${tip.reason}`),
        time: tip.time ?? t("prepare.tooltip.unknownTime"),
      });
    case "lastIndexed":
      return t("prepare.tooltip.lastIndexed", { time: tip.time, sha: tip.sha });
    case "notRecorded":
      return t("prepare.tooltip.notRecorded", { sha: tip.sha });
  }
}
