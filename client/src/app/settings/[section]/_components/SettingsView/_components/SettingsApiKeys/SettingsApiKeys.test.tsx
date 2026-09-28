import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { createQueryClient } from "@/lib/query-client";
import settingsMessages from "../../../../../../../../messages/en/settings.json";
import { SettingsApiKeys } from "./SettingsApiKeys";

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ notify: { error: (m: string) => toastError(m) } }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  toastError.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderKeys() {
  // The app's real client, so the global MutationCache toast policy is live.
  return renderWithProviders(<SettingsApiKeys />, {
    namespaces: { settings: settingsMessages },
    queryClient: createQueryClient(() => "fallback"),
  });
}

describe("SettingsApiKeys", () => {
  it("reveals and hides a key with a labelled toggle button", () => {
    fetchMock.mockResolvedValue(json({ openai: true, anthropic: false, openrouter: false, github: false }));
    renderKeys();

    const [toggle] = screen.getAllByRole("button", { name: "Show key" });
    const input = screen.getByLabelText(settingsMessages.apiKeys.openaiLabel);
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(toggle!);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(input).toHaveAttribute("type", "text");

    fireEvent.click(toggle!);
    expect(input).toHaveAttribute("type", "password");
  });

  it("shows a failed connection test inline once, without a second global toast", async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).endsWith("/settings/secrets-status")) {
        return json({ openai: false, anthropic: false, openrouter: false, github: false });
      }
      return json({ error: { code: "bad_key", message: "OpenAI rejected the key" } }, 401);
    });
    renderKeys();

    // Rows render in KEY_ROWS order; the first is OpenAI.
    const [testOpenAi] = screen.getAllByRole("button", { name: "Test connection" });
    fireEvent.click(testOpenAi!);

    expect(await screen.findByText("OpenAI rejected the key")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(toastError).not.toHaveBeenCalled();
  });
});
