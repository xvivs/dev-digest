import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Markdown } from "./Markdown";

const BODY = `# PR Quality Rubric

Evaluate the PR. Be **worth the author's time**.

## Correctness

- Does the change do what it claims?
- Are edge cases handled?

1. first
2. second

\`\`\`ts
const x = 1;
\`\`\`
`;

describe("Markdown", () => {
  it("renders headings as heading elements, not paragraphs", () => {
    render(<Markdown>{BODY}</Markdown>);
    expect(screen.getByRole("heading", { level: 1, name: "PR Quality Rubric" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Correctness" })).toBeInTheDocument();
  });

  it("renders bullet and numbered lists with visible markers", () => {
    render(<Markdown>{BODY}</Markdown>);
    const [bullets, numbered] = screen.getAllByRole("list");
    expect(within(bullets!).getAllByRole("listitem")).toHaveLength(2);
    expect(bullets).toHaveStyle({ listStyle: "disc" });
    expect(numbered).toHaveStyle({ listStyle: "decimal" });
  });

  it("renders a fenced block as one code surface with its raw text", () => {
    const { container } = render(<Markdown>{BODY}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).toHaveTextContent("const x = 1;");
    // The inline-code chip is not nested inside the block.
    expect(pre!.querySelector("code")).not.toHaveAttribute("style");
  });

  it("in safe mode turns an image into a link that shows its destination", () => {
    render(<Markdown safe>{"![logo](https://evil.test/x.png)"}</Markdown>);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "logo (https://evil.test/x.png)" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("outside safe mode keeps links in the same tab", () => {
    render(<Markdown>{"[docs](https://example.test)"}</Markdown>);
    expect(screen.getByRole("link", { name: "docs" })).not.toHaveAttribute("target");
  });
});
