import { describe, it, expect } from "vitest";
import type { Repo } from "@/lib/types";
import { activeKeyFor, isRepoSynced, isTextInput, toShellRepo } from "./helpers";

const repo = (o: Partial<Repo> = {}): Repo =>
  ({ id: "r1", full_name: "acme/api", default_branch: "main", last_polled_at: null, ...o }) as Repo;

describe("toShellRepo", () => {
  const label = (synced: boolean) => (synced ? "SYNCED" : "NOT SYNCED");

  it("maps a repo and lets the caller word the sync state", () => {
    expect(toShellRepo(repo({ last_polled_at: "2026-06-01T00:00:00Z" }), label)).toEqual({
      id: "r1",
      full_name: "acme/api",
      default_branch: "main",
      syncedLabel: "SYNCED",
    });
    expect(toShellRepo(repo(), label).syncedLabel).toBe("NOT SYNCED");
  });
});

describe("isRepoSynced", () => {
  it("is true only once the poller has stamped the repo", () => {
    expect(isRepoSynced({ last_polled_at: "2026-06-01T00:00:00Z" })).toBe(true);
    expect(isRepoSynced({ last_polled_at: null })).toBe(false);
  });
});

describe("isTextInput", () => {
  it("recognises inputs, textareas and contenteditable nodes", () => {
    expect(isTextInput(document.createElement("input"))).toBe(true);
    expect(isTextInput(document.createElement("textarea"))).toBe(true);
    const div = document.createElement("div");
    expect(isTextInput(div)).toBe(false);
    expect(isTextInput(null)).toBe(false);
  });
});

describe("activeKeyFor", () => {
  it("maps route paths to sidebar keys", () => {
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/pulls/482")).toBe("pulls");
    expect(activeKeyFor("/agents/a1")).toBe("agents");
    expect(activeKeyFor("/settings/models")).toBe("settings");
    expect(activeKeyFor("/")).toBe("");
  });
});
