import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "./api";

const error = vi.fn();
vi.mock("./toast", () => ({ notify: { error: (m: string) => error(m) } }));

import { createQueryClient } from "./query-client";

const FALLBACK = "Something went wrong";

async function failMutation(meta?: { errorSurface?: "global" | "local" }, err: unknown = new Error("boom")) {
  const qc = createQueryClient(() => FALLBACK);
  const mutation = qc.getMutationCache().build(qc, {
    mutationFn: () => Promise.reject(err),
    meta,
  });
  await mutation.execute(undefined).catch(() => {});
}

async function failQuery(err: unknown) {
  const qc = createQueryClient(() => FALLBACK);
  await qc
    .fetchQuery({ queryKey: ["q"], queryFn: () => Promise.reject(err), retry: false })
    .catch(() => {});
}

beforeEach(() => error.mockReset());

describe("createQueryClient — mutation errors", () => {
  it("toasts once by default", async () => {
    await failMutation();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("boom");
  });

  it("stays silent for errorSurface: local", async () => {
    await failMutation({ errorSurface: "local" });
    expect(error).not.toHaveBeenCalled();
  });

  it("uses the fallback copy for a non-Error rejection", async () => {
    await failMutation(undefined, "nope");
    expect(error).toHaveBeenCalledWith(FALLBACK);
  });
});

describe("createQueryClient — query errors", () => {
  it("toasts network (0) and 5xx errors", async () => {
    await failQuery(new ApiError("down", 0));
    await failQuery(new ApiError("oops", 503));
    expect(error.mock.calls).toEqual([["down"], ["oops"]]);
  });

  it("keeps expected 4xx silent", async () => {
    await failQuery(new ApiError("no tour yet", 404));
    expect(error).not.toHaveBeenCalled();
  });
});
