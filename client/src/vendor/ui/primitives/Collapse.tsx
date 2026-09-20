import React from "react";

/** Enter/exit durations. Exit is shorter — a disclosure should feel eager to close. */
const IN_MS = 200;
const OUT_MS = 180;

/**
 * Collapse — the animated body of a disclosure (one collapsible region, not a
 * set of them: a multi-section accordion composes several of these).
 *
 * Height is animated through `grid-template-rows: 0fr → 1fr`, so nothing here
 * ever measures a node. `height: auto` does not interpolate without
 * `interpolate-size`, and `max-height` has to guess a ceiling — which breaks the
 * moment the body holds Markdown or a nested panel.
 *
 * The node stays mounted for the length of the exit animation and is then
 * dropped, so a closed region costs nothing and is invisible to `find by text`.
 * Completion is read from `element.getAnimations()` rather than `onAnimationEnd`:
 * jsdom implements neither, and the optional call there yields an empty list, so
 * tests unmount synchronously and keep the exact DOM contract of a plain
 * `{open && …}`. An `animationend` listener would simply never fire under jsdom
 * and the body would stay in the tree forever.
 *
 * Two deliberate limits:
 *  - the inner wrapper is permanently `overflow: hidden` — a child that must
 *    escape the box (a floating menu, a tooltip) has to portal out, as
 *    `FindingsPopover` already does;
 *  - reversing mid-flight restarts the keyframes from their own start rather
 *    than from the current position. Acceptable at these durations.
 *
 * `prefers-reduced-motion` needs no handling here: `styles.css` already forces
 * every animation to 0.01ms, which collapses this into an instant open/close.
 */
export function Collapse({
  open,
  children,
  id,
}: {
  open: boolean;
  children: React.ReactNode;
  /** Pairs with `aria-controls` on the trigger that toggles this region. */
  id?: string;
}) {
  const [rendered, setRendered] = React.useState(open);
  const ref = React.useRef<HTMLDivElement>(null);

  // Adjusting state during render, not in an effect: an effect would mount the
  // body one commit late and the enter animation would start a frame behind.
  if (open && !rendered) setRendered(true);

  React.useEffect(() => {
    if (open || !rendered) return;

    const running = ref.current?.getAnimations?.() ?? [];
    if (running.length === 0) {
      setRendered(false);
      return;
    }

    let live = true;
    // `allSettled`: an animation cancelled by a re-open rejects `finished`, and
    // that is not an error — the cleanup below already handles it.
    void Promise.allSettled(running.map((a) => a.finished)).then(() => {
      if (live) setRendered(false);
    });
    return () => {
      live = false;
    };
  }, [open, rendered]);

  if (!rendered) return null;

  return (
    <div
      ref={ref}
      id={id}
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        animation: open
          ? `ddCollapseIn ${IN_MS}ms ease`
          : `ddCollapseOut ${OUT_MS}ms ease`,
      }}
    >
      {/* `min-height: 0` is what lets the 0fr track actually collapse — without
          it the row floors at the content's min-content height. */}
      <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
