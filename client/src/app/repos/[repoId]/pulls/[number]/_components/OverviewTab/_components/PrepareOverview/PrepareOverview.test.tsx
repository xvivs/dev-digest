/* Spec 06 AC-12, AC-12a, AC-15, AC-17, AC-21: the Prepare overview button. */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import { renderWithProviders } from "@/test/render";
import { json, setupFakeApi } from "@/test/fake-api";
import { PrepareOverview } from "./PrepareOverview";
import { readiness } from "./testFixtures";

const api = setupFakeApi();
afterEach(cleanup);

const READINESS = "/pulls/p1/overview/readiness";
const PREPARE = "/pulls/p1/overview/prepare";
const namespaces = { brief };

const render = () => renderWithProviders(<PrepareOverview prId="p1" />, { namespaces });

/** The button once readiness has loaded (while loading it is a disabled "Prepare overview"). */
async function loadedButton(name: string) {
  await waitFor(() => expect(api.requestsTo("GET", READINESS).length).toBeGreaterThan(0));
  await waitFor(() => expect(screen.getByRole("button", { name })).toHaveAttribute("title"));
  return screen.getByRole("button", { name });
}

describe("PrepareOverview", () => {
  it("actions present → click sends one POST {} and the button turns busy", async () => {
    api.reply("GET", READINESS, readiness({ actions: ["index_incremental"] }));
    api.reply(
      "POST",
      PREPARE,
      { status: "started", started: ["index_incremental"], failed: [], readiness: readiness({ index: { in_flight: true } }) },
      202,
    );
    render();
    const button = await loadedButton(brief.prepare.label);
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: brief.prepare.preparing })).toBeDisabled());
    expect(api.requestsTo("POST", PREPARE).map((r) => r.body)).toEqual([{}]);
  });

  it("nothing to do → disabled with the ready label", async () => {
    api.reply("GET", READINESS, readiness());
    render();
    expect(await screen.findByRole("button", { name: brief.prepare.ready })).toBeDisabled();
  });

  it("only reindex_partial offered → Update index sends { reindex_partial: true }", async () => {
    api.reply("GET", READINESS, readiness({ index: { status: "partial", partial_reason: "soft_budget" }, explicit_actions: ["reindex_partial"] }));
    api.route("POST", PREPARE, () =>
      json({ status: "started", started: ["reindex_partial"], failed: [], readiness: readiness({ index: { status: "partial", in_flight: true } }) }, 202),
    );
    render();
    await userEvent.setup().click(await screen.findByRole("button", { name: brief.prepare.updateIndex }));
    await waitFor(() => expect(api.requestsTo("POST", PREPARE)).toHaveLength(1));
    expect(api.requestsTo("POST", PREPARE)[0]?.body).toEqual({ reindex_partial: true });
  });

  it("head_moved → disabled blocked label and no Refresh PR here", async () => {
    api.reply("GET", READINESS, readiness({ blocked_by: "head_moved", brief: { intent_failure: { reason: "head_moved", at: "x" } } }));
    render();
    expect(await screen.findByRole("button", { name: brief.prepare.blocked })).toBeDisabled();
    expect(screen.queryByRole("button", { name: brief.failure.refreshPr })).toBeNull();
  });

  it("provider_not_configured → a link to Settings → API Keys", async () => {
    api.reply("GET", READINESS, readiness({ blocked_by: "provider_not_configured" }));
    render();
    const link = await screen.findByRole("link", { name: brief.prepare.openSettings });
    expect(link).toHaveAttribute("href", "/settings/api-keys");
  });

  it("the accessible description and the title carry the tooltip text", async () => {
    api.reply("GET", READINESS, readiness({ index: { last_indexed_at: null } }));
    render();
    const button = await screen.findByRole("button", { name: brief.prepare.ready });
    const text = brief.prepare.tooltip.notRecorded.replace("{sha}", "abcdef1");
    expect(button).toHaveAccessibleDescription(text);
    expect(button).toHaveAttribute("title", text);
  });

  it("never indexed / flag off texts", async () => {
    api.reply("GET", READINESS, readiness({ index: { status: "missing", last_indexed_sha: null, last_indexed_at: null }, actions: ["index_full"] }));
    render();
    expect(await loadedButton(brief.prepare.label)).toHaveAccessibleDescription(brief.prepare.tooltip.never);
    cleanup();
    api.reply("GET", READINESS, readiness({ index: { status: "flag_off", last_indexed_sha: null } }));
    render();
    expect(await screen.findByRole("button", { name: brief.prepare.ready })).toHaveAccessibleDescription(brief.prepare.tooltip.flagOff);
  });

  it("a response with failed steps shows a muted note", async () => {
    api.reply("GET", READINESS, readiness({ actions: ["derive_brief"] }));
    api.reply("POST", PREPARE, { status: "skipped", started: [], failed: ["derive_brief"], readiness: readiness({ actions: ["derive_brief"] }) }, 202);
    render();
    await userEvent.setup().click(await loadedButton(brief.prepare.label));
    expect(await screen.findByText(brief.prepare.failedSome)).toBeInTheDocument();
  });

  it("a failed clone with clone in the plan → explains the reason and keeps Prepare enabled", async () => {
    api.reply(
      "GET",
      READINESS,
      readiness({
        clone: { status: "missing", last_failure: { reason: "not_found", at: "2026-09-30T12:00:00.000Z" } },
        index: { status: "no_clone", last_indexed_sha: null, last_indexed_at: null },
        actions: ["clone"],
      }),
    );
    render();
    const button = await loadedButton(brief.prepare.label);
    expect(screen.getByText(brief.prepare.cloneFailed.not_found)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("no explanation without a failure, or while the clone is not in the plan", async () => {
    api.reply("GET", READINESS, readiness({ clone: { status: "missing" }, index: { status: "no_clone" }, actions: ["clone"] }));
    render();
    await loadedButton(brief.prepare.label);
    expect(screen.queryByText(/The last clone failed/)).toBeNull();
    cleanup();
    api.reply(
      "GET",
      READINESS,
      readiness({ clone: { status: "missing", in_flight: true, last_failure: { reason: "auth", at: "x" } }, actions: [] }),
    );
    render();
    await screen.findByRole("button", { name: brief.prepare.preparing });
    expect(screen.queryByText(/The last clone failed/)).toBeNull();
  });
});
