/**
 * VersionsTab — list, inline diff and the Restore popup, driven through the
 * REAL skill hooks with only the transport (`api`) faked, so the requests,
 * the restore guard and the cache invalidation are exercised end to end.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import messages from "../../../../../../../../messages/en/skills.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import common from "../../../../../../../../messages/en/common.json";

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: h.get, post: h.post } };
});

import { VersionsTab } from "./VersionsTab";

const SKILL: Skill = {
  id: "sk1",
  name: "gate",
  description: "Flags untested branches.",
  type: "rubric",
  source: "manual",
  body: "# Rule\nline two\n",
  enabled: true,
  version: 4,
  needs_vetting: false,
};

const snap = (version: number, over: Partial<SkillVersion> = {}): SkillVersion => ({
  skill_id: "sk1",
  version,
  name: "gate",
  description: "Flags untested branches.",
  type: "rubric",
  change_note: null,
  created_at: "2026-09-29T10:00:00.000Z",
  body: "# Rule\nline two\n",
  ...over,
});

// v2 is a gap: its body was never stored (pre-ADR 0016 history).
const SNAPSHOTS: Record<number, SkillVersion> = {
  4: snap(4, { change_note: "Tightened wording" }),
  3: snap(3, { body: "# Rule\nline 2\n" }),
  1: snap(1, { name: "gate-old", body: "# Rule\n" }),
};
const summary = ({ body: _body, ...rest }: SkillVersion) => rest;

function routeGet(path: string) {
  if (path === "/skills/sk1/versions") return Promise.resolve([4, 3, 1].map((v) => summary(SNAPSHOTS[v]!)));
  const m = /^\/skills\/sk1\/versions\/(\d+)$/.exec(path);
  if (m) {
    const s = SNAPSHOTS[Number(m[1])];
    return s ? Promise.resolve(s) : Promise.reject(new ApiError("not found", 404, "not_found"));
  }
  if (path === "/skills/sk1") return Promise.resolve(SKILL);
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

function renderTab(skill: Skill = SKILL, onEditVersion = vi.fn()) {
  const view = renderWithProviders(
    <ToastProvider>
      <VersionsTab skill={skill} onEditVersion={onEditVersion} />
    </ToastProvider>,
    { namespaces: { skills: messages, shell: shellMessages, common } },
  );
  return { ...view, onEditVersion };
}

async function rows() {
  const list = await screen.findByRole("list", { name: "Version history" });
  return within(list).getAllByRole("listitem");
}

beforeEach(() => {
  h.get.mockReset().mockImplementation(routeGet);
  h.post.mockReset();
});
afterEach(cleanup);

describe("VersionsTab list", () => {
  it("lists versions newest first, badges the current one and shows lost history as a gap", async () => {
    renderTab();
    const items = await rows();
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^v4Current.*Tightened wording/),
      expect.stringMatching(/^v3.*No note/),
      expect.stringMatching(/^v2 body unavailable/),
      expect.stringMatching(/^v1.*No note/),
    ]);
  });

  it("offers Restore on older versions but not on the current one", async () => {
    renderTab();
    await rows();
    expect(screen.queryByRole("button", { name: "Restore v4" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore v3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore v1" })).toBeInTheDocument();
  });

  it("shows a retryable error when the history fails to load", async () => {
    h.get.mockImplementation((p: string) => (p === "/skills/sk1/versions" ? Promise.reject(new ApiError("boom", 500)) : routeGet(p)));
    renderTab();
    expect(await screen.findByText("Could not load the version history.")).toBeInTheDocument();
  });
});

describe("VersionsTab diff", () => {
  it("diffs vN against vN−1 with +/− markers that have accessible names", async () => {
    renderTab();
    const [, v3] = await rows();
    fireEvent.click(within(v3!).getByRole("button", { name: "Diff" }));
    const region = await screen.findByRole("region", { name: "Changes in v3" });
    // v2 is a gap, so there is no previous snapshot for v3.
    expect(within(region).getByRole("button", { name: "vs previous" })).toBeDisabled();
    expect(within(region).getByRole("button", { name: "vs current" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(region).findByText("v3 → current (v4)")).toBeInTheDocument();
    expect(within(region).getByRole("img", { name: "removed" }).parentElement).toHaveTextContent("line 2");
    expect(within(region).getByRole("img", { name: "added" }).parentElement).toHaveTextContent("line two");
    expect(within(region).getByText("+1 −1 lines")).toBeInTheDocument();
  });

  it("disables vs previous for v1 and shows changed metadata above the body diff", async () => {
    renderTab();
    const items = await rows();
    fireEvent.click(within(items[3]!).getByRole("button", { name: "Diff" }));
    const region = await screen.findByRole("region", { name: "Changes in v1" });
    const prev = within(region).getByRole("button", { name: "vs previous" });
    expect(prev).toBeDisabled();
    expect(prev).toHaveAttribute("title", "v1 has no previous version.");
    const table = await within(region).findByRole("table");
    expect(within(table).getByRole("row", { name: "name gate-old gate" })).toBeInTheDocument();
    // Metadata sits before the body section in document order.
    const bodyTitle = within(region).getByText("Body");
    expect(table.compareDocumentPosition(bodyTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the current version compares only with its predecessor", async () => {
    h.get.mockImplementation((p: string) =>
      p === "/skills/sk1/versions" ? Promise.resolve([4, 3].map((v) => summary(SNAPSHOTS[v]!))) : routeGet(p),
    );
    renderTab();
    const [v4] = await rows();
    fireEvent.click(within(v4!).getByRole("button", { name: "Diff" }));
    const region = await screen.findByRole("region", { name: "Changes in v4" });
    expect(within(region).getByRole("button", { name: "vs current" })).toBeDisabled();
    expect(within(region).getByRole("button", { name: "vs previous" })).toHaveAttribute("aria-pressed", "true");
    expect(await within(region).findByText("v3 → v4")).toBeInTheDocument();
  });
});

describe("Restore popup", () => {
  async function openRestore(version: number) {
    await rows();
    fireEvent.click(screen.getByRole("button", { name: `Restore v${version}` }));
    return screen.getByRole("dialog", { name: `Restore v${version}` });
  }

  it("offers Edit, Restore and Cancel, each explained in one line", async () => {
    renderTab();
    const dialog = await openRestore(3);
    expect(within(dialog).getByRole("button", { name: "Edit" })).toHaveAccessibleDescription(
      "Open v3 in the editor as a draft. Saving creates a new version.",
    );
    expect(within(dialog).getByRole("button", { name: "Restore" })).toHaveAccessibleDescription(
      "Create v5 with the content of v3 right away.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveAccessibleDescription("Close without changing anything.");
    expect(within(dialog).queryByText(/was imported/)).not.toBeInTheDocument();
  });

  it("Cancel and Escape close without any request", async () => {
    renderTab();
    let dialog = await openRestore(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    dialog = await openRestore(3);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });

  it("Edit hands the version to Config and writes nothing", async () => {
    const { onEditVersion } = renderTab();
    const dialog = await openRestore(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    expect(onEditVersion).toHaveBeenCalledWith(3);
    expect(h.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Restore creates vN+1 at once, guarded by the version this screen saw, then refreshes the history", async () => {
    h.post.mockResolvedValue({ skill: { ...SKILL, version: 5, body: SNAPSHOTS[3]!.body }, restored: true });
    const { queryClient } = renderTab();
    const dialog = await openRestore(3);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.post).toHaveBeenCalledWith("/skills/sk1/versions/3/restore", { expected_version: 4 }, expect.anything());
    expect(screen.getByText("Restored v3 as v5")).toBeInTheDocument();
    expect(invalidate.mock.calls.map((c) => c[0]?.queryKey)).toEqual(
      expect.arrayContaining([["skill", "sk1"], ["skill-versions", "sk1"], ["skill-stats", "sk1"], ["skills"], ["agent-skills"]]),
    );
  });

  it("says so when the snapshot already matches (no new version)", async () => {
    h.post.mockResolvedValue({ skill: SKILL, restored: false });
    renderTab();
    const dialog = await openRestore(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("v3 already matches the current skill, so no new version was created.")).toBeInTheDocument();
  });

  it("a 409 reads 'skill changed — reload' inline, and Reload refetches the skill and its history", async () => {
    h.post.mockRejectedValue(new ApiError("stale", 409, "skill_version_stale", { expected_version: 4, current_version: 5 }));
    renderTab();
    const dialog = await openRestore(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Skill changed since you opened it. Reload to see the latest version, then try again.");
    expect(within(dialog).getByRole("button", { name: "Restore" })).toBeDisabled();
    h.get.mockClear();
    fireEvent.click(within(alert).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(h.get.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["/skills/sk1", "/skills/sk1/versions"])));
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows any other failure inline with the server message", async () => {
    h.post.mockRejectedValue(new ApiError("Skill name \"gate-old\" is taken", 409, "skill_name_taken"));
    renderTab();
    const dialog = await openRestore(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent('Could not restore: Skill name "gate-old" is taken');
  });

  it("warns that restoring an imported skill resets vetting", async () => {
    renderTab({ ...SKILL, source: "imported" });
    const dialog = await openRestore(3);
    expect(within(dialog).getByText(/This skill was imported\. A new body resets vetting/)).toBeInTheDocument();
  });
});
