import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { zipSync } from "fflate";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import messages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";
import common from "../../../../../messages/en/common.json";

const h = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.pushMock }) }));
vi.mock("@/lib/hooks", () => ({
  useCreateSkill: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

const MD_WITH_FRONTMATTER = [
  "---",
  "name: pr-quality-rubric",
  "description: Use when a PR lacks tests. Flags missing coverage.",
  "type: rubric",
  "---",
  "",
  "# Rule",
  "Body text.",
].join("\n");

function mdFile(text: string, name = "pr-quality-rubric.md") {
  return new File([text], name, { type: "text/markdown" });
}

function renderDrawer(onClose = vi.fn()) {
  return {
    onClose,
    ...renderWithProviders(
      <ToastProvider>
        <ImportSkillDrawer onClose={onClose} />
      </ToastProvider>,
      { namespaces: { skills: messages, shell: shellMessages, common } },
    ),
  };
}

const pickFile = (file: File) => {
  const input = screen.getByLabelText("Choose file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(() => {
  h.mutateAsync.mockReset().mockResolvedValue({ id: "sk-new", name: "pr-quality-rubric" });
  h.pushMock.mockReset();
});
afterEach(cleanup);

describe("ImportSkillDrawer", () => {
  it("picking a .md file shows the preview, and Import creates it with source: imported", async () => {
    const { onClose } = renderDrawer();

    pickFile(mdFile(MD_WITH_FRONTMATTER));

    expect(await screen.findByText("This is someone else's instructions. Once enabled, it goes into your agent's prompt.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Use when a PR lacks tests. Flags missing coverage.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import skill" }));

    await waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({
        name: "pr-quality-rubric",
        description: "Use when a PR lacks tests. Flags missing coverage.",
        type: "rubric",
        body: "# Rule\nBody text.",
        source: "imported",
      }),
    );
    expect(onClose).toHaveBeenCalled();
    expect(h.pushMock).toHaveBeenCalledWith("/skills/sk-new?tab=config");
  });

  it("Cancel closes without picking a file and never creates a skill", () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it("a zip with no SKILL.md shows an inline parse error and stores nothing", async () => {
    const bytes = zipSync({ "README.txt": new TextEncoder().encode("nothing here") });
    const file = new File([bytes], "no-skill.zip", { type: "application/zip" });

    renderDrawer();
    pickFile(file);

    expect(await screen.findByText("No SKILL.md found at the archive root or one level deep.")).toBeInTheDocument();
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });
});
