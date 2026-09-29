import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import skills from "@/../messages/en/skills.json";
import { renderWithProviders } from "@/test/render";
import type { Skill } from "@devdigest/shared";

const LONG = "A very long description that goes on and on ".repeat(6).trim();

vi.mock("@/lib/hooks", () => ({
  useSkillVersion: (_id: string, version: number | null) => ({
    data: version === 1 ? { name: "s", description: "short", type: "checklist", body: "x" } : version === 2 ? { name: "s", description: LONG, type: "checklist", body: "x" } : undefined,
    isLoading: false,
    isError: false,
  }),
}));

import { VersionDiff } from "./VersionDiff";
import { FIELD_COL_WIDTH } from "./constants";

afterEach(cleanup);

const skill = { id: "sk", name: "s", description: LONG, type: "checklist", body: "x", version: 2 } as unknown as Skill;

describe("VersionDiff metadata table", () => {
  it("keeps the Field column readable: fixed layout, nowrap row header, sized col", () => {
    renderWithProviders(<VersionDiff skill={skill} version={2} hasPrevSnapshot />, { namespaces: { skills } });

    const header = screen.getByRole("rowheader", { name: "description" });
    expect(header).toHaveStyle({ whiteSpace: "nowrap" });

    const table = header.closest("table") as HTMLTableElement;
    expect(table).toHaveStyle({ tableLayout: "fixed" });

    const cols = table.querySelectorAll("colgroup > col");
    expect(cols).toHaveLength(3);
    expect((cols[0] as HTMLElement).style.width).toBe(FIELD_COL_WIDTH);
    expect((cols[1] as HTMLElement).style.width).toBe("");
    expect((cols[2] as HTMLElement).style.width).toBe("");
  });
});
