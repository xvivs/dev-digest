import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../../messages/en/skills.json";

import { PreviewTab } from "./PreviewTab";

afterEach(cleanup);

const renderTab = (body: string) =>
  renderWithProviders(<PreviewTab body={body} />, { namespaces: { skills: messages } });

describe("PreviewTab", () => {
  it("renders the body as markdown by default, with the receiving-agent caption", () => {
    renderTab("Use when a branch is **untested**.");
    expect(screen.getByRole("heading", { level: 2, name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByText("untested")).toBeInTheDocument();
  });

  it("renders an image as a link and opens links in a new tab (Markdown safe)", () => {
    renderTab("![diagram](https://example.com/d.png) and a [link](https://example.com)");
    // Safe mode shows the real destination next to the alt text.
    const img = screen.getByRole("link", { name: "diagram (https://example.com/d.png)" });
    expect(img.tagName).toBe("A");
    expect(img).toHaveAttribute("href", "https://example.com/d.png");
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Source view marks an invisible character", () => {
    renderTab("safe​text");
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    const mark = screen.getByTitle("U+200B");
    expect(mark.tagName).toBe("MARK");
    expect(
      screen.getByText("This body contains invisible or bidirectional characters, marked below."),
    ).toBeInTheDocument();
  });

  it("Source view warns about an HTML comment, hidden from Rendered", () => {
    renderTab("visible <!-- hidden instruction -->");
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("This body contains HTML comments, hidden from the rendered view.")).toBeInTheDocument();
  });

  it("shows neither warning for a plain body", () => {
    renderTab("Use when a branch is untested.");
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.queryByText(/invisible or bidirectional/)).not.toBeInTheDocument();
    expect(screen.queryByText(/HTML comments/)).not.toBeInTheDocument();
  });
});
