import { afterAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

// Pin the runtime zone away from UTC so the client render (no explicit
// timeZone, i.e. the runtime default) actually differs from the SSR render
// (pinned to "UTC" by LocalTime itself) — without this the two branches can
// coincidentally produce the same string and the test can't fail. Node
// re-reads `process.env.TZ` on every Intl/Date call (verified on this repo's
// Node 22: no ICU caching of an earlier default), so setting it here is safe
// even though other test files in the same vitest worker already touched
// Date/Intl before this file runs.
const PREV_TZ = process.env.TZ;
process.env.TZ = "Pacific/Kiritimati"; // UTC+14 — always disagrees with UTC
// Restore it so later files in the same worker keep the host zone.
afterAll(() => {
  if (PREV_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = PREV_TZ;
});

import { LocalTime } from "./LocalTime";

const ISO = "2026-09-28T10:15:30.000Z";
// Expected strings are pinned as literals, not recomputed via `formatWhen`:
// recomputing would make the assertion pass even if `formatWhen` itself broke
// in the same way on both sides.
const SSR_TEXT = "9/28/2026, 10:15:30 AM"; // formatWhen(ISO, { locale: "en", timeZone: "UTC" })
const CLIENT_TEXT = "9/29/2026, 12:15:30 AM"; // formatWhen(ISO) under TZ=Pacific/Kiritimati

describe("LocalTime", () => {
  it("renders the UTC form on the server", () => {
    const html = renderToString(<LocalTime iso={ISO} />);
    expect(html).toContain(SSR_TEXT);
    expect(html).toContain(`dateTime="${ISO}"`);
  });

  it("renders the viewer's local form on the client, which differs from the SSR form", () => {
    render(<LocalTime iso={ISO} />);
    expect(screen.getByText(CLIENT_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(SSR_TEXT)).not.toBeInTheDocument();
  });

  it("echoes an unparseable input instead of 'Invalid Date'", () => {
    render(<LocalTime iso="not-a-date" />);
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
