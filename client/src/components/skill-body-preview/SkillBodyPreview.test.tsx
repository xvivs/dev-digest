import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import messages from "../../../messages/en/skills.json";
import { SkillBodyPreview } from "./SkillBodyPreview";

afterEach(cleanup);

const render = (body: string) => renderWithProviders(<SkillBodyPreview body={body} />, { namespaces: { skills: messages } });

describe("SkillBodyPreview", () => {
  it("starts in the rendered view", () => {
    render("Use when a branch is untested.");
    expect(screen.getByRole("tab", { name: "Rendered" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Use when a branch is untested.")).toBeInTheDocument();
  });

  it("marks invisible characters and flags HTML comments in the source view only", () => {
    render("a​b <!-- hidden -->");
    expect(screen.queryByText(/invisible or bidirectional/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByText("[U+200B]")).toBeInTheDocument();
    expect(screen.getByText(/invisible or bidirectional/)).toBeInTheDocument();
    expect(screen.getByText(/HTML comments/)).toBeInTheDocument();
  });
});
