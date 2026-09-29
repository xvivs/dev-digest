/** ScanHeader — the header line and stats strip of AC-34, and the Re-scan button's states. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../messages/en/conventions.json";
import costMessages from "../../../../../../../messages/en/cost.json";
import { scan } from "../../fixtures";
import { ScanHeader } from "./ScanHeader";

afterEach(cleanup);

function renderHeader(props: Partial<Parameters<typeof ScanHeader>[0]> = {}) {
  const onRescan = vi.fn();
  renderWithProviders(
    <ScanHeader repoName="payments-api" scan={scan()} onRescan={onRescan} scanning={false} rescanDisabled={false} {...props} />,
    { namespaces: { conventions: messages, cost: costMessages } },
  );
  return { onRescan };
}

describe("ScanHeader", () => {
  it("titles the page with the repo name", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conventions in payments-api");
  });

  it("reads 'Detected from N sample files · last scan X ago'", () => {
    renderHeader();
    expect(screen.getByText(/^Detected from 84 sample files · last scan .+ ago$/)).toBeInTheDocument();
  });

  it("shows every stat of the scan", () => {
    renderHeader();
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    const values = Object.fromEntries(
      ["Found", "Verified", "Dropped", "Relocated", "Model", "Tokens", "Cost", "Duration"].map((label) => [
        label,
        within(stats).getByText(label).nextElementSibling?.textContent,
      ]),
    );
    expect(values).toEqual({
      Found: "5",
      Verified: "3",
      Dropped: "2",
      Relocated: "1",
      Model: "deepseek/deepseek-v4-flash",
      Tokens: "12.3k in · 950 out",
      Cost: "~$0.0012",
      Duration: "42s",
    });
  });

  it("marks an estimated cost with ~ and a provider-billed one without", () => {
    cleanup();
    renderHeader({ scan: scan({ cost_usd: 0.5, cost_source: "provider" }) });
    expect(screen.getByText("$0.500")).toBeInTheDocument();
  });

  it("shows a dash for stats the scan did not record", () => {
    renderHeader({ scan: scan({ model: null, tokens_in: null, tokens_out: null, cost_usd: null, cost_source: null, duration_ms: null }) });
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    expect(within(stats).getAllByText("—")).toHaveLength(4);
  });

  it("explains the page and hides the stats before a first scan", () => {
    renderHeader({ scan: null });
    expect(screen.getByText(/Scan the cloned repo to surface house-rules/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
  });

  it("re-scans on click", () => {
    const { onRescan } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("disables Re-scan and says so while scanning", () => {
    renderHeader({ scanning: true });
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("disables Re-scan when told to", () => {
    renderHeader({ rescanDisabled: true });
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeDisabled();
  });
});
