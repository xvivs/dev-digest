import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { PriorPrs } from "./PriorPrs";

const api = setupFakeApi();
afterEach(cleanup);

describe("PriorPrs", () => {
  it("is closed by default and reveals prior PRs on click", async () => {
    const user = userEvent.setup();
    api.reply("GET", "/pulls/p1/history", {
      status: "ok",
      reason: null,
      history: [
        { pr_number: 12, title: "Tighten limiter", merged_at: "2026-09-01T00:00:00Z", author: "ann", files_overlap: ["a.ts"], notes: "" },
      ],
      queried_paths: ["a.ts"],
      cached: false,
      computed_at: null,
    });
    renderWithProviders(<PriorPrs prId="p1" />, { namespaces: { brief } });
    const toggle = await screen.findByRole("button", { name: /Prior PRs touching these files/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Tighten limiter")).toBeNull();

    await user.click(toggle);

    expect(await screen.findByText("Tighten limiter")).toBeInTheDocument();
  });
});
