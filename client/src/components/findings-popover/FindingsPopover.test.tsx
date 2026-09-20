import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import findingsMessages from "../../../messages/en/findings.json";
import { OPEN_DELAY, CLOSE_DELAY } from "./constants";
import { FindingsPopover } from "./FindingsPopover";

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "Unvalidated user input reaches the query",
    file: "src/db/query.ts",
    start_line: 42,
    end_line: 42,
    rationale: "The value flows straight into a template literal with no escaping.",
    suggestion: null,
    confidence: 0.92,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

// Distinct file/line and confidence per finding: the panel renders three of
// them side by side, so identical metadata would make every query ambiguous.
const FINDINGS = [
  finding({
    id: "f1",
    severity: "SUGGESTION",
    title: "Prefer const",
    category: "style",
    file: "src/util/fmt.ts",
    start_line: 7,
    end_line: 7,
    confidence: 0.41,
  }),
  finding({ id: "f2", severity: "CRITICAL", title: "SQL injection", category: "security" }),
  finding({
    id: "f3",
    severity: "WARNING",
    title: "N+1 query",
    category: "perf",
    file: "src/api/list.ts",
    start_line: 10,
    end_line: 18,
    confidence: 0.7,
  }),
  finding({
    id: "f4",
    severity: "WARNING",
    title: "Missing test",
    category: "test",
    file: "src/api/create.ts",
    start_line: 3,
    end_line: 3,
    confidence: 0.55,
  }),
];

type Props = React.ComponentProps<typeof FindingsPopover>;

function renderPopover(props: Partial<Props> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
      <FindingsPopover total={4} findings={FINDINGS} runLinked {...props}>
        <span tabIndex={0}>anchor</span>
      </FindingsPopover>
    </NextIntlClientProvider>,
  );
}

const anchor = () => screen.getByText("anchor");

function openIt() {
  fireEvent.mouseOver(anchor());
  act(() => {
    vi.advanceTimersByTime(OPEN_DELAY);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 120,
    y: 200,
    top: 200,
    left: 120,
    right: 480,
    bottom: 240,
    width: 360,
    height: 40,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FindingsPopover", () => {
  it("opens on hover after the delay and closes again after the grace period", () => {
    renderPopover();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Not yet — the open delay has to elapse first.
    fireEvent.mouseOver(anchor());
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY - 1);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseOut(anchor());
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY - 1);
    });
    expect(screen.queryByRole("tooltip")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("previews the worst findings first, with location, confidence and category — and no buttons", () => {
    renderPopover();
    openIt();

    const tip = screen.getByRole("tooltip");

    // A tooltip must contain nothing focusable: it vanishes when the cursor leaves.
    expect(within(tip).queryAllByRole("button")).toHaveLength(0);

    expect(within(tip).getByText("4 findings in this run")).toBeInTheDocument();
    expect(within(tip).getByText("src/db/query.ts:42")).toBeInTheDocument();
    // A multi-line finding renders its span, not just the first line.
    expect(within(tip).getByText("src/api/list.ts:10-18")).toBeInTheDocument();
    expect(within(tip).getByText("92% conf")).toBeInTheDocument();
    expect(within(tip).getByText("security")).toBeInTheDocument();

    // CRITICAL → WARNING → SUGGESTION, capped at PREVIEW_LIMIT (3 of 4).
    expect(within(tip).getByText("SQL injection")).toBeInTheDocument();
    expect(within(tip).getByText("N+1 query")).toBeInTheDocument();
    expect(within(tip).getByText("Missing test")).toBeInTheDocument();
    expect(within(tip).queryByText("Prefer const")).not.toBeInTheDocument();
    expect(within(tip).getByText("+1 more")).toBeInTheDocument();
  });

  it("titles the panel for a review when it is not linked to a run", () => {
    renderPopover({ runLinked: false, total: 2, findings: FINDINGS.slice(0, 2) });
    openIt();
    expect(screen.getByText("2 findings in this review")).toBeInTheDocument();
    expect(screen.queryByText("+1 more")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderPopover();
    openIt();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on a scroll anywhere in the page, including a non-bubbling container scroll", () => {
    renderPopover();
    openIt();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    act(() => {
      document.body.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens from the keyboard and closes on blur", () => {
    renderPopover();

    fireEvent.focus(anchor());
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(anchor());
    act(() => {
      vi.advanceTimersByTime(CLOSE_DELAY);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("describes the anchor only while the panel exists", () => {
    const { container } = renderPopover();
    const wrapper = container.querySelector("span[style]");
    expect(wrapper).not.toHaveAttribute("aria-describedby");

    openIt();
    expect(wrapper?.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });

  it("shows the loading, empty and error states", () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
        <FindingsPopover total={3} findings={undefined} runLinked>
          <span tabIndex={0}>anchor</span>
        </FindingsPopover>
      </NextIntlClientProvider>,
    );
    openIt();
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
        <FindingsPopover total={3} findings={[]} error runLinked>
          <span tabIndex={0}>anchor</span>
        </FindingsPopover>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Could not load findings.")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
        <FindingsPopover total={0} findings={[]} runLinked>
          <span tabIndex={0}>anchor</span>
        </FindingsPopover>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("No findings in this run.")).toBeInTheDocument();
  });

  it("arms exactly once no matter how many times the anchor is hovered", () => {
    const onArm = vi.fn();
    renderPopover({ onArm });

    for (let i = 0; i < 3; i++) {
      openIt();
      fireEvent.mouseOut(anchor());
      act(() => {
        vi.advanceTimersByTime(CLOSE_DELAY);
      });
    }

    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it("does not arm when the cursor only sweeps past the anchor", () => {
    const onArm = vi.fn();
    renderPopover({ onArm });

    fireEvent.mouseOver(anchor());
    act(() => {
      vi.advanceTimersByTime(OPEN_DELAY - 20);
    });
    fireEvent.mouseOut(anchor());
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onArm).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("clears its timers when the anchor unmounts mid-flight", () => {
    const onArm = vi.fn();
    const { unmount } = renderPopover({ onArm });

    fireEvent.mouseOver(anchor());
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onArm).not.toHaveBeenCalled();
  });
});
