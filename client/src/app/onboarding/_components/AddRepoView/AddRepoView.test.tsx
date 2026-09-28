import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { createQueryClient } from "@/lib/query-client";
import addRepoMessages from "../../../../../messages/en/addRepo.json";
import { AddRepoView } from "./AddRepoView";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { error: (m: string) => toastError(m) } }));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  push.mockReset();
  toastError.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderView() {
  // The app's real client, so the global MutationCache toast policy is live.
  return renderWithProviders(<AddRepoView />, {
    namespaces: { addRepo: addRepoMessages },
    queryClient: createQueryClient(() => "fallback"),
  });
}

function typeUrl(value: string) {
  fireEvent.change(screen.getByPlaceholderText("https://github.com/owner/repo"), { target: { value } });
}

describe("AddRepoView", () => {
  it("keeps submit disabled until a URL is entered", () => {
    renderView();
    const submit = screen.getByRole("button", { name: "Add repository" });
    expect(submit).toBeDisabled();
    typeUrl("   ");
    expect(submit).toBeDisabled();
    typeUrl("https://github.com/acme/api");
    expect(submit).toBeEnabled();
  });

  it("shows the API's error inline once, without a second global toast, and stays on the page", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found", message: "Repository not found on GitHub" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    renderView();

    typeUrl("  https://github.com/acme/missing  ");
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Repository not found on GitHub");
    expect(toastError).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://github.com/acme/missing" });
  });

  it("opens the new repository's pull requests on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "r1" }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    renderView();

    typeUrl("https://github.com/acme/api");
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/repos/r1/pulls"));
  });

  it("links to the API keys settings and closes on Escape", () => {
    renderView();
    expect(screen.getByRole("link", { name: "Settings → API Keys" })).toHaveAttribute("href", "/settings/api-keys");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(push).toHaveBeenCalledWith("/");
  });
});
