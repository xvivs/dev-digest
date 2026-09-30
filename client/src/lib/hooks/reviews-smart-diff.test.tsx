/**
 * usePrSmartDiff: the placeholder keeps the previous grouping only for the SAME
 * PR (head move -> no flat-list flash) and never leaks another PR's roles.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { SmartDiff } from "@devdigest/shared";
import { createTestQueryClient } from "@/test/render";

const pending: Array<{ path: string; resolve: (v: SmartDiff) => void }> = [];
const get = vi.fn(
  (path: string) => new Promise<SmartDiff>((resolve) => pending.push({ path, resolve })),
);
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: { ...actual.api, get: (p: string) => get(p) } };
});

import { usePrSmartDiff } from "./reviews";

const sd = (path: string): SmartDiff => ({
  groups: [
    { role: "core", files: [{ path, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "tests", files: [] },
    { role: "wiring", files: [] },
    { role: "docs", files: [] },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
});

afterEach(() => {
  cleanup();
  pending.length = 0;
  get.mockClear();
});

function setup(initial: { prId: string | null; sha: string }) {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook((p: { prId: string | null; sha: string }) => usePrSmartDiff(p.prId, p.sha), {
    wrapper,
    initialProps: initial,
  });
}

describe("usePrSmartDiff", () => {
  it("keeps the previous grouping while the same PR refetches for a new head", async () => {
    const { result, rerender } = setup({ prId: "pr-1", sha: "a" });
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolve(sd("first.ts"));
    await waitFor(() => expect(result.current.data?.groups[0]?.files[0]?.path).toBe("first.ts"));

    rerender({ prId: "pr-1", sha: "b" });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.path).toBe("/pulls/pr-1/smart-diff");
    expect(result.current.data?.groups[0]?.files[0]?.path).toBe("first.ts"); // placeholder
    expect(result.current.isPlaceholderData).toBe(true);

    pending[1]!.resolve(sd("second.ts"));
    await waitFor(() => expect(result.current.data?.groups[0]?.files[0]?.path).toBe("second.ts"));
  });

  it("never shows another PR's grouping while the new PR loads", async () => {
    const { result, rerender } = setup({ prId: "pr-1", sha: "a" });
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolve(sd("first.ts"));
    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ prId: "pr-2", sha: "a" });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.path).toBe("/pulls/pr-2/smart-diff");
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch without a PR id", () => {
    setup({ prId: null, sha: "a" });
    expect(get).not.toHaveBeenCalled();
  });
});
