import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test/render";

const get = vi.fn();
vi.mock("../api", () => ({ api: { get: (path: string) => get(path) } }));

import { useAgentsSkillLinks } from "./agents";

const link = (agent_id: string) => ({ agent_id, skill_id: "s1", order: 0, enabled: true });

function wrapper({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(createTestQueryClient);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Braces matter: a function returned from beforeEach is run as a cleanup hook, and `get.mockReset()` returns the mock.
beforeEach(() => {
  get.mockReset();
});
afterEach(cleanup);

describe("useAgentsSkillLinks", () => {
  it("returns each agent's links keyed by id, pending until all arrive", async () => {
    get.mockImplementation((path: string) => Promise.resolve([link(path.split("/")[2] ?? "")]));
    const { result } = renderHook(() => useAgentsSkillLinks(["ag1", "ag2"]), { wrapper });
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(get).toHaveBeenCalledWith("/agents/ag1/skills");
    expect(get).toHaveBeenCalledWith("/agents/ag2/skills");
    expect([...result.current.byAgent.keys()]).toEqual(["ag1", "ag2"]);
    expect(result.current.byAgent.get("ag2")).toEqual([link("ag2")]);
  });

  it("leaves an agent whose links failed out of the map", async () => {
    get.mockImplementation((path: string) =>
      path.includes("ag2") ? Promise.reject(new Error("boom")) : Promise.resolve([link("ag1")]),
    );
    const { result } = renderHook(() => useAgentsSkillLinks(["ag1", "ag2"]), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect([...result.current.byAgent.keys()]).toEqual(["ag1"]);
  });

  it("fetches nothing for no agents", () => {
    const { result } = renderHook(() => useAgentsSkillLinks([]), { wrapper });
    expect(get).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(false);
    expect(result.current.byAgent.size).toBe(0);
  });
});
