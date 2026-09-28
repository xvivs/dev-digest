import { describe, expect, it } from "vitest";
import type { PrReviewComment } from "@/lib/types";
import { buildThreads, commentTargetFor, keysForLine, partitionThreads } from "./comments";

let nextId = 1;
function comment(over: Partial<PrReviewComment> = {}): PrReviewComment {
  const id = over.id ?? nextId++;
  return {
    id,
    path: "src/a.ts",
    line: 5,
    original_line: 5,
    side: "RIGHT",
    body: `comment ${id}`,
    user: "octocat",
    created_at: "2026-09-01T10:00:00Z",
    html_url: `https://github.com/acme/api/pull/1#discussion_r${id}`,
    in_reply_to_id: null,
    is_outdated: false,
    ...over,
  };
}

describe("buildThreads", () => {
  it("returns no threads for no comments", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("groups replies under their root and orders each thread oldest-first", () => {
    const root = comment({ id: 10, created_at: "2026-09-01T10:00:00Z" });
    const lateReply = comment({ id: 12, in_reply_to_id: 10, created_at: "2026-09-01T12:00:00Z", line: null });
    const earlyReply = comment({ id: 11, in_reply_to_id: 10, created_at: "2026-09-01T11:00:00Z" });
    const other = comment({ id: 20, line: 9, side: "LEFT" });

    const threads = buildThreads([lateReply, root, other, earlyReply]);

    expect(threads).toHaveLength(2);
    const [first, second] = threads;
    expect(first).toMatchObject({ rootId: 10, line: 5, side: "RIGHT", isOutdated: false });
    expect(first!.comments.map((c) => c.id)).toEqual([10, 11, 12]);
    expect(second).toMatchObject({ rootId: 20, line: 9, side: "LEFT", isOutdated: false });
  });

  it("anchors a thread on the root's line, not a reply's", () => {
    const [thread] = buildThreads([
      comment({ id: 30, line: 7 }),
      comment({ id: 31, in_reply_to_id: 30, line: 99 }),
    ]);
    expect(thread!.line).toBe(7);
  });

  it("marks a thread outdated when GitHub dropped the root's line", () => {
    const [thread] = buildThreads([comment({ id: 40, line: null, is_outdated: true })]);
    expect(thread).toMatchObject({ rootId: 40, line: null, isOutdated: true });
  });

  it("falls back to the oldest comment when only replies of a root are present", () => {
    const [thread] = buildThreads([
      comment({ id: 51, in_reply_to_id: 50, line: 3, created_at: "2026-09-02T00:00:00Z" }),
      comment({ id: 52, in_reply_to_id: 50, line: 8, created_at: "2026-09-03T00:00:00Z" }),
    ]);
    expect(thread).toMatchObject({ rootId: 50, line: 3 });
  });
});

describe("keysForLine / commentTargetFor", () => {
  it("keys context lines on both sides, adds on RIGHT and deletes on LEFT", () => {
    expect(keysForLine({ kind: "ctx", text: "", oldNo: 4, newNo: 6 })).toEqual(["RIGHT:6", "LEFT:4"]);
    expect(keysForLine({ kind: "add", text: "", newNo: 7 })).toEqual(["RIGHT:7"]);
    expect(keysForLine({ kind: "del", text: "", oldNo: 5 })).toEqual(["LEFT:5"]);
    expect(keysForLine({ kind: "hunk", text: "@@" })).toEqual([]);
  });

  it("targets the new line for adds and context, the old line for deletes, nothing for hunks", () => {
    expect(commentTargetFor({ kind: "add", text: "", newNo: 7 })).toEqual({ line: 7, side: "RIGHT" });
    expect(commentTargetFor({ kind: "ctx", text: "", oldNo: 4, newNo: 6 })).toEqual({ line: 6, side: "RIGHT" });
    expect(commentTargetFor({ kind: "del", text: "", oldNo: 5 })).toEqual({ line: 5, side: "LEFT" });
    expect(commentTargetFor({ kind: "hunk", text: "@@" })).toBeNull();
  });
});

describe("partitionThreads", () => {
  it("matches threads to rendered keys and sends the rest to outdated", () => {
    const threads = buildThreads([
      comment({ id: 60, line: 5, side: "RIGHT" }),
      comment({ id: 61, line: 5, side: "RIGHT" }),
      comment({ id: 62, line: 5, side: "LEFT" }),
      comment({ id: 63, line: null }),
      comment({ id: 64, line: 500 }),
    ]);

    const { matched, outdated } = partitionThreads(threads, new Set(["RIGHT:5"]));

    expect([...matched.keys()]).toEqual(["RIGHT:5"]);
    expect(matched.get("RIGHT:5")!.map((t) => t.rootId)).toEqual([60, 61]);
    // LEFT:5 is not rendered, 63 lost its line, 64 points outside this patch.
    expect(outdated.map((t) => t.rootId)).toEqual([62, 63, 64]);
  });

  it("puts everything in outdated when nothing is rendered", () => {
    const threads = buildThreads([comment({ id: 70 })]);
    const { matched, outdated } = partitionThreads(threads, new Set());
    expect(matched.size).toBe(0);
    expect(outdated).toHaveLength(1);
  });
});
