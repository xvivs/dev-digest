import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SeverityCounts } from "@devdigest/shared";
import findingsMessages from "../../../messages/en/findings.json";
import { SeverityIcons } from "./SeverityIcons";

afterEach(cleanup);

function renderIcons(props: Partial<React.ComponentProps<typeof SeverityIcons>> = {}) {
  const counts: SeverityCounts = props.counts ?? { critical: 2, warning: 3, suggestion: 1 };
  return render(
    <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
      <SeverityIcons {...props} counts={counts} />
    </NextIntlClientProvider>,
  );
}

describe("SeverityIcons", () => {
  it("renders only non-zero severities, worst first, each with its count", () => {
    renderIcons({ counts: { critical: 0, warning: 3, suggestion: 1 }, onSelect: vi.fn() });

    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["3 Warning findings", "1 Suggestion finding"]);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders nothing at all when every severity is zero", () => {
    const { container } = renderIcons({ counts: { critical: 0, warning: 0, suggestion: 0 } });
    expect(container).toBeEmptyDOMElement();
  });

  it("with onSelect: renders buttons, reflects `selected` via aria-pressed, and reports clicks", () => {
    const onSelect = vi.fn();
    renderIcons({ selected: "WARNING", onSelect });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "2 Critical findings" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("CRITICAL");
  });

  it("without onSelect: renders no buttons but stays keyboard-reachable as a popover anchor", () => {
    const { container } = renderIcons();

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const focusable = container.querySelectorAll('[tabindex="0"]');
    expect(focusable).toHaveLength(3);
    expect(focusable[0]).toHaveAttribute("aria-label", "2 Critical findings");
  });

  it("tags every chip with data-severity, in both render shapes", () => {
    // The attribute is a contract, not decoration: FindingsPopover delegates on
    // it to scope its preview to the chip under the cursor. Both shapes carry
    // it — the button one (a filter control) and the inert span one (a bare
    // popover anchor).
    const { container, rerender } = renderIcons({ onSelect: vi.fn() });
    expect(
      Array.from(container.querySelectorAll("[data-severity]")).map((el) =>
        el.getAttribute("data-severity"),
      ),
    ).toEqual(["CRITICAL", "WARNING", "SUGGESTION"]);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ findings: findingsMessages }}>
        <SeverityIcons counts={{ critical: 2, warning: 3, suggestion: 1 }} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelectorAll("[data-severity]")).toHaveLength(3);
  });

  it("underlines the count — the only affordance that the cell is interactive", () => {
    renderIcons();
    // Dotted and tinted to the severity: a solid rule reads as a link, and an
    // untinted one detaches the number from the icon it belongs to.
    expect(screen.getByText("2")).toHaveStyle({
      textDecorationLine: "underline",
      textDecorationStyle: "dotted",
      textDecorationColor: "var(--crit)",
    });
  });
});
