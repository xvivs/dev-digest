/**
 * FindingsPopover — hover/focus preview of a PR's findings, anchored to
 * whatever the caller passes as `children` (in practice `<SeverityIcons />`).
 *
 * Shape of the thing:
 *  - the panel is portalled to <body> and rendered ONLY while open, so the
 *    measuring `useLayoutEffect` lives in a child that never renders on the
 *    server (no SSR warning) and never measures a detached node;
 *  - `onArm` fires inside the open timer, exactly once per mounted anchor —
 *    a cursor sweeping down a PR list must not fire one fetch per row;
 *  - the panel is a `role="tooltip"` and contains NO interactive element.
 *    A tooltip that only exists while the cursor hovers it cannot host a
 *    button: the target is unreachable by keyboard and hostile by pointer.
 *    That is why `file:line` is a plain span and not `MonoLink` (which renders
 *    a <button> when given no href).
 */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { CLOSE_DELAY, OPEN_DELAY, PANEL_GAP, PREVIEW_LIMIT } from "./constants";
import { clampToViewport, lineLabel, sortBySeverity, type PanelPosition } from "./helpers";
import { s } from "./styles";

type Timer = ReturnType<typeof setTimeout> | null;

interface PanelContentProps {
  /** Known up-front from the severity counts — drives the header and "+N more". */
  total: number;
  /** `undefined` = not fetched yet. An empty array is a real, loaded "no findings". */
  findings: FindingRecord[] | undefined;
  loading?: boolean;
  error?: boolean;
}

export function FindingsPopover({
  children,
  total,
  findings,
  loading,
  error,
  runLinked,
  onArm,
}: PanelContentProps & {
  /** The anchor. Must contain something focusable for the keyboard path to work. */
  children: React.ReactNode;
  /** true → "in this run", false → "in this review". */
  runLinked: boolean;
  /** Called once, inside the open timer, to let the caller start fetching. */
  onArm?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const openTimer = React.useRef<Timer>(null);
  const closeTimer = React.useRef<Timer>(null);
  const armed = React.useRef(false);
  const panelId = React.useId();

  const cancelOpen = React.useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const scheduleOpen = React.useCallback(() => {
    cancelClose();
    if (open || openTimer.current !== null) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      // Inside the timer, not in the event handler: hover-intent has to be
      // proven before we spend a request. Once per anchor, forever.
      if (!armed.current) {
        armed.current = true;
        onArm?.();
      }
      setOpen(true);
    }, OPEN_DELAY);
  }, [cancelClose, onArm, open]);

  const scheduleClose = React.useCallback(() => {
    cancelOpen();
    if (closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY);
  }, [cancelOpen]);

  /** Escape / scroll / resize dismiss immediately — the grace period exists only
      so the cursor can reach the panel, and none of these are the cursor. */
  const closeNow = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    setOpen(false);
  }, [cancelClose, cancelOpen]);

  // The anchor can unmount mid-flight — the PR list re-polls every 60s.
  React.useEffect(
    () => () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current);
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeNow();
    };
    // Capture phase, on `document`: the app's scroll container is
    // `<main style={{overflow:"auto"}}>` (vendor/ui/shell/AppFrame.tsx) and
    // `scroll` does not bubble, so a window listener would never fire.
    document.addEventListener("scroll", closeNow, { capture: true, passive: true });
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeNow);
    return () => {
      document.removeEventListener("scroll", closeNow, { capture: true });
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeNow);
    };
  }, [open, closeNow]);

  return (
    <span
      ref={anchorRef}
      style={s.anchor}
      aria-describedby={open ? panelId : undefined}
      onMouseOver={scheduleOpen}
      onMouseOut={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
      onClick={scheduleOpen}
    >
      {children}
      {open &&
        createPortal(
          <FindingsPanel
            anchorRef={anchorRef}
            panelId={panelId}
            total={total}
            findings={findings}
            loading={loading}
            error={error}
            runLinked={runLinked}
            onMouseOver={cancelClose}
            onMouseOut={scheduleClose}
          />,
          document.body,
        )}
    </span>
  );
}

/**
 * Rendered only while open. That is what makes `useLayoutEffect` safe here:
 * the component never reaches a server render, so React never warns.
 */
function FindingsPanel({
  anchorRef,
  panelId,
  runLinked,
  onMouseOver,
  onMouseOut,
  ...content
}: PanelContentProps & {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  panelId: string;
  runLinked: boolean;
  onMouseOver: () => void;
  onMouseOut: () => void;
}) {
  const t = useTranslations("findings");
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<PanelPosition | null>(null);

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    if (!anchor || !card) return;
    setPos(
      clampToViewport({
        anchor,
        panel: { w: card.width, h: card.height },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        gap: PANEL_GAP,
      }),
    );
  }, [anchorRef]);

  // Stable across load states: `findings` is undefined while fetching, so an
  // icon derived from the findings themselves would flip under the user.
  const HeaderIcon = content.total > 0 ? Icon.AlertOctagon : Icon.Info;

  return (
    <div style={s.shell(pos)} onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      <div ref={cardRef} id={panelId} role="tooltip" style={s.card}>
        <div style={s.header}>
          <HeaderIcon size={13} style={s.headerIcon} aria-hidden />
          {/* Uppercased in CSS, not in the message: the JSON stays lowercase so
              locales without a case distinction are not mangled. */}
          <span style={s.headerText}>
            {t(runLinked ? "popover.titleRun" : "popover.titleReview", { count: content.total })}
          </span>
        </div>
        <PanelBody {...content} />
      </div>
    </div>
  );
}

function PanelBody({ total, findings, loading, error }: PanelContentProps) {
  const t = useTranslations("findings");

  if (error) return <div style={s.status}>{t("popover.error")}</div>;
  if (loading || findings === undefined) return <div style={s.status}>{t("popover.loading")}</div>;
  if (findings.length === 0) return <div style={s.status}>{t("popover.empty")}</div>;

  const preview = sortBySeverity(findings).slice(0, PREVIEW_LIMIT);
  const hidden = total - PREVIEW_LIMIT;

  return (
    <>
      <div style={s.list}>
        {preview.map((f, i) => (
          <FindingPreview key={f.id} f={f} first={i === 0} />
        ))}
      </div>
      {hidden > 0 && <div style={s.more}>{t("popover.more", { count: hidden })}</div>}
    </>
  );
}

function FindingPreview({ f, first }: { f: FindingRecord; first: boolean }) {
  return (
    <div style={s.item(first)}>
      <div style={s.titleRow}>
        <SeverityBadge severity={f.severity} compact />
        <span style={s.findingTitle}>{f.title}</span>
        <CategoryTag category={f.category} />
      </div>
      <div style={s.metaRow}>
        <span className="mono" style={s.location}>
          {f.file}:{lineLabel(f)}
        </span>
        <ConfidenceNum value={f.confidence} />
      </div>
      <div style={s.rationale}>{f.rationale}</div>
    </div>
  );
}
