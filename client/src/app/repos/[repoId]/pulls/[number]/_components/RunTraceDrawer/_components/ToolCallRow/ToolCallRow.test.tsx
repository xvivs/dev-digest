import { describe, it, expect, afterEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import type { ToolCall } from "@devdigest/shared";
import runs from "@/../messages/en/runs.json";
import { renderWithProviders } from "@/test/render";
import { ToolCallRow } from "./ToolCallRow";

afterEach(cleanup);

const CALL: ToolCall = { tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 };

const renderRow = (tc: ToolCall) => renderWithProviders(<ToolCallRow tc={tc} />, { namespaces: { runs } });

describe("ToolCallRow", () => {
  it("shows tool, args, meta and duration in a collapsed native-button header", () => {
    renderRow(CALL);
    const header = screen.getByRole("button", { name: /review_file/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("review_file(src/config.ts)");
    expect(header).toHaveTextContent("single-pass");
    // Raw integer, not locale-grouped ("1,200ms").
    expect(header).toHaveTextContent("1200ms");
    expect(screen.queryByText(/preview truncated/)).not.toBeInTheDocument();
  });

  it("expands to the args/result detail and collapses again", () => {
    renderRow(CALL);
    const header = screen.getByRole("button", { name: /review_file/ });

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByText(/preview truncated/);
    expect(detail).toHaveTextContent("args: src/config.ts");
    expect(detail).toHaveTextContent("result: single-pass (preview truncated)");
    expect(document.getElementById(header.getAttribute("aria-controls")!)).toContainElement(detail);

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to a dash when the call carries no meta", () => {
    renderRow({ ...CALL, meta: null });
    fireEvent.click(screen.getByRole("button", { name: /review_file/ }));
    expect(screen.getByText(/preview truncated/)).toHaveTextContent("result: — (preview truncated)");
  });
});
