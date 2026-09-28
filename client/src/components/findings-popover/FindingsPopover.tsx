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
 *
 * The panel is scoped to the severity chip under the cursor. That severity is
 * read off the event target's `data-severity` (see `SeverityIcons`) rather than
 * pushed in through a prop: `onMouseOver`/`onFocus` already bubble to this
 * anchor, so delegation costs nothing, adds no prop to a `React.memo` child and
 * keeps the hover state in the only component that renders the panel.
 */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Icon, SEV, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { isSeverity } from "@/components/severity-icons";
import { CLOSE_DELAY, OPEN_DELAY, PANEL_GAP, PREVIEW_LIMIT } from "./constants";
import { clampToViewport, lineLabel, sortBySeverity, type PanelPosition } from "./helpers";
import { s } from "./styles";

type Timer = ReturnType<typeof setTimeout> | null;

interface PanelContentProps {
  /** Known up-front from the severity counts — drives the header and "+N more". */
  total: number;
  /** Chip under the cursor. `null` = the whole tally, i.e. no chip hovered yet. */
  severity?: Severity | null;
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
  const [hovered, setHovered] = React.useState<Severity | null>(null);
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const openTimer = React.useRef<Timer>(null);
  const closeTimer = React.useRef<Timer>(null);
  const armed = React.useRef(false);
  const panelId = React.useId();

  /**
   * Which chip is the pointer (or focus) on? Reads the nearest `data-severity`
   * ancestor of the event target. Never trusts the string: the attribute is DOM
   * state, and `isSeverity` is the same guard the tally itself uses.
   *
   * Leaving a chip deliberately does NOT clear the scope. The cursor has to
   * cross dead space to reach the panel, and dropping the filter halfway there
   * would swap the content out from under the reader. It clears when the panel
   * closes, and only then.
   */
  const trackSeverity = React.useCallback((e: React.SyntheticEvent) => {
    const chip = (e.target as HTMLElement | null)?.closest?.("[data-severity]");
    const raw = chip?.getAttribute("data-severity");
    if (raw != null && isSeverity(raw)) setHovered(raw);
  }, []);

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
      setHovered(null);
    }, CLOSE_DELAY);
  }, [cancelOpen]);

  /** Escape / scroll / resize dismiss immediately — the grace period exists only
      so the cursor can reach the panel, and none of these are the cursor. */
  const closeNow = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    setOpen(false);
    setHovered(null);
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
      onMouseOver={(e) => {
        trackSeverity(e);
        scheduleOpen();
      }}
      onMouseOut={scheduleClose}
      onFocus={(e) => {
        trackSeverity(e);
        scheduleOpen();
      }}
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
            severity={hovered}
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

  // The scoped count can only be known once the findings are in hand — the
  // `total` prop is the whole tally and `SeverityCounts` is not passed down. So
  // while the fetch is in flight the header stays unscoped rather than lying.
  const scope =
    content.severity != null && content.findings !== undefined
      ? {
          severity: content.severity,
          count: content.findings.filter((f) => f.severity === content.severity).length,
        }
      : null;

  return (
    <div style={s.shell(pos)} onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      <div ref={cardRef} id={panelId} role="tooltip" style={s.card}>
        <div style={s.header}>
          <HeaderIcon size={13} style={s.headerIcon} aria-hidden />
          {/* Uppercased in CSS, not in the message: the JSON stays lowercase so
              locales without a case distinction are not mangled. */}
          <span style={s.headerText}>
            {scope
              ? t(runLinked ? "popover.titleRunSeverity" : "popover.titleReviewSeverity", {
                  count: scope.count,
                  // `SEV` labels are the same source `SeverityIcons` uses for its
                  // `aria-label`, so the chip and the panel always read alike.
                  severity: SEV[scope.severity].label,
                })
              : t(runLinked ? "popover.titleRun" : "popover.titleReview", {
                  count: content.total,
                })}
          </span>
        </div>
        <PanelBody {...content} />
      </div>
    </div>
  );
}

function PanelBody({ total, severity, findings, loading, error }: PanelContentProps) {
  const t = useTranslations("findings");

  if (error) return <div style={s.status}>{t("popover.error")}</div>;
  if (loading || findings === undefined) return <div style={s.status}>{t("popover.loading")}</div>;
  if (findings.length === 0) return <div style={s.status}>{t("popover.empty")}</div>;

  // Scoped to the hovered chip. `shown.length` rather than the `total` prop
  // once scoped — and it is safe to count here because the guards above have
  // already proven the findings are loaded. It also fixes an "+N more" that
  // used to mix two sources: `total` comes from the severity tally, which is
  // computed independently of the findings this panel actually received.
  const shown = severity != null ? findings.filter((f) => f.severity === severity) : findings;
  if (shown.length === 0) return <div style={s.status}>{t("popover.empty")}</div>;

  const preview = sortBySeverity(shown).slice(0, PREVIEW_LIMIT);
  const hidden = (severity != null ? shown.length : total) - PREVIEW_LIMIT;

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
