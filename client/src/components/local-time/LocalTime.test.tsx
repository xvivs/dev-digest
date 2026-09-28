import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { LocalTime } from "./LocalTime";
import { formatWhen } from "@/lib/format-date";

const ISO = "2026-09-28T10:15:30.000Z";

describe("LocalTime", () => {
  it("renders the UTC form on the server", () => {
    const html = renderToString(<LocalTime iso={ISO} />);
    expect(html).toContain(formatWhen(ISO, { locale: "en", timeZone: "UTC" }));
    expect(html).toContain(`dateTime="${ISO}"`);
  });

  it("renders the viewer's local form on the client", () => {
    render(<LocalTime iso={ISO} />);
    expect(screen.getByText(formatWhen(ISO))).toBeInTheDocument();
  });

  it("echoes an unparseable input instead of 'Invalid Date'", () => {
    render(<LocalTime iso="not-a-date" />);
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
