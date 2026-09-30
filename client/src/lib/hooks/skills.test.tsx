import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import { RestoreSkillVersionResult, SkillStats, SkillVersion, SkillVersionSummary } from "@devdigest/shared/contracts/skill-impact";
import { createTestQueryClient } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("../api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

import { useAgentSkills } from "./agents";
import { useRestoreSkillVersion, useSkill, useSkills, useSkillStats, useSkillVersion, useSkillVersions, useUpdateSkill } from "./skills";

const SKILL: Skill = {
  id: "sk1",
  name: "gate",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "# Rule v1",
  enabled: true,
  version: 4,
  needs_vetting: false,
};

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
});
afterEach(cleanup);

describe("useSkillVersions", () => {
  it("GETs the version list with its response schema", async () => {
    get.mockResolvedValue([]);
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useSkillVersions("sk1"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills/sk1/versions", expect.anything());
    // ADR 0007: the schema passed is the contract array, not a hand-rolled copy.
    const schema = get.mock.calls[0]![1] as typeof SkillVersionSummary;
    expect(schema.safeParse([{ skill_id: "sk1", version: 1, name: null, description: null, type: null, change_note: null, created_at: "x" }]).success).toBe(true);
    expect(qc.getQueryData(["skill-versions", "sk1"])).toEqual([]);
  });

  it("does not fetch without an id", () => {
    renderHook(() => useSkillVersions(null), { wrapper: wrapperFor(createTestQueryClient()) });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useSkillVersion", () => {
  it("GETs one snapshot with the SkillVersion schema", async () => {
    get.mockResolvedValue({});
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useSkillVersion("sk1", 3), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills/sk1/versions/3", SkillVersion);
  });

  it("does not fetch without a version", () => {
    renderHook(() => useSkillVersion("sk1", null), { wrapper: wrapperFor(createTestQueryClient()) });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useRestoreSkillVersion", () => {
  it("POSTs expected_version and invalidates skill, versions, stats, the list and agent-skills", async () => {
    const restored = { ...SKILL, version: 5, body: "# old" };
    post.mockResolvedValue({ skill: restored, restored: true });
    const qc = createTestQueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRestoreSkillVersion(), { wrapper: wrapperFor(qc) });

    await act(async () => {
      await result.current.mutateAsync({ id: "sk1", version: 2, expectedVersion: 4 });
    });

    expect(post).toHaveBeenCalledWith("/skills/sk1/versions/2/restore", { expected_version: 4 }, RestoreSkillVersionResult);
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["skill", "sk1"], ["skill-versions", "sk1"], ["skill-stats", "sk1"], ["skills"], ["agent-skills"]]),
    );
    expect(qc.getQueryData(["skill", "sk1"])).toEqual(restored);
  });

  it("after a restore, every mounted consumer of the skill refetches: detail, versions, stats, list and agent-skills", async () => {
    post.mockResolvedValue({ skill: { ...SKILL, version: 5 }, restored: true });
    let serverVersion = 4;
    get.mockImplementation((path: string) => Promise.resolve(path === "/skills/sk1" ? { ...SKILL, version: serverVersion } : []));
    const qc = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        detail: useSkill("sk1"),
        versions: useSkillVersions("sk1"),
        stats: useSkillStats("sk1", "30d"),
        list: useSkills(),
        agentSkills: useAgentSkills("ag1"),
        restore: useRestoreSkillVersion(),
      }),
      { wrapper: wrapperFor(qc) },
    );
    const settled = () =>
      [result.current.detail, result.current.versions, result.current.stats, result.current.list, result.current.agentSkills].every(
        (q) => q.isSuccess,
      );
    await waitFor(() => expect(settled()).toBe(true));
    get.mockClear();
    serverVersion = 5;

    await act(async () => {
      await result.current.restore.mutateAsync({ id: "sk1", version: 2, expectedVersion: 4 });
    });

    await waitFor(() => {
      const paths = get.mock.calls.map((c) => c[0] as string);
      expect(paths).toEqual(
        expect.arrayContaining(["/skills/sk1/versions", "/skills/sk1/stats?window=30d", "/skills", "/agents/ag1/skills"]),
      );
    });
    await waitFor(() => expect(get.mock.calls.map((c) => c[0] as string)).toContain("/skills/sk1"));
    expect(result.current.detail.data?.version).toBe(5);
  });

  it("forwards meta so the caller can own the error surface (ADR 0011)", async () => {
    post.mockRejectedValue(new Error("boom"));
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useRestoreSkillVersion({ meta: { errorSurface: "local" } }), {
      wrapper: wrapperFor(qc),
    });
    await act(async () => {
      await result.current.mutateAsync({ id: "sk1", version: 2, expectedVersion: 4 }).catch(() => undefined);
    });
    expect(qc.getMutationCache().getAll()[0]?.meta).toEqual({ errorSurface: "local" });
  });
});

describe("useUpdateSkill", () => {
  it("sends change_note and also invalidates the version list", async () => {
    put.mockResolvedValue({ ...SKILL, version: 5 });
    const qc = createTestQueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useUpdateSkill(), { wrapper: wrapperFor(qc) });
    await act(async () => {
      await result.current.mutateAsync({ id: "sk1", patch: { body: "x", change_note: "why" } });
    });
    expect(put).toHaveBeenCalledWith("/skills/sk1", { body: "x", change_note: "why" });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(expect.arrayContaining([["skills"], ["agent-skills"], ["skill-versions", "sk1"]]));
  });
});

describe("useSkillStats", () => {
  it("GETs the window's stats with the SkillStats schema, keyed under ['skill-stats', id]", async () => {
    get.mockResolvedValue({ window: "7d" });
    const qc = createTestQueryClient();
    const { result } = renderHook(() => useSkillStats("sk1", "7d"), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/skills/sk1/stats?window=7d", SkillStats);
    // Restore invalidates the ['skill-stats', id] prefix; every window sits under it.
    expect(qc.getQueryData(["skill-stats", "sk1", "7d"])).toEqual({ window: "7d" });
  });

  it("keeps the previous window's numbers on screen while the next window loads", async () => {
    let resolve90: (v: unknown) => void = () => {};
    get.mockImplementation((path: string) =>
      path.endsWith("90d") ? new Promise((r) => (resolve90 = r)) : Promise.resolve({ window: "30d" }),
    );
    const { result, rerender } = renderHook(({ w }: { w: "30d" | "90d" }) => useSkillStats("sk1", w), {
      wrapper: wrapperFor(createTestQueryClient()),
      initialProps: { w: "30d" },
    });
    await waitFor(() => expect(result.current.data).toEqual({ window: "30d" }));
    rerender({ w: "90d" });
    expect(result.current.data).toEqual({ window: "30d" });
    expect(result.current.isPlaceholderData).toBe(true);
    await act(async () => resolve90({ window: "90d" }));
    await waitFor(() => expect(result.current.data).toEqual({ window: "90d" }));
  });

  it("does not fetch without an id", () => {
    renderHook(() => useSkillStats(null, "30d"), { wrapper: wrapperFor(createTestQueryClient()) });
    expect(get).not.toHaveBeenCalled();
  });
});
