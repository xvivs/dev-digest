import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";

/** What the mocked SSE hook reports on the next render. */
const sse: { events: { t: string; kind: string; msg: string }[]; running: boolean } = {
  events: [],
  running: false,
};
const useRunEvents = vi.fn((_runIds: string[]) => sse);
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (runIds: string[]) => useRunEvents(runIds),
}));

import { RunStatus } from "./RunStatus";

afterEach(() => {
  cleanup();
  sse.events = [];
  sse.running = false;
  useRunEvents.mockClear();
});

const renderStatus = (ui: React.ReactElement) => renderWithProviders(ui, { namespaces: { prReview } });

describe("RunStatus", () => {
  it("renders nothing when there are no run ids", () => {
    const { container } = renderStatus(<RunStatus runIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("while the stream is open: subscribes to every run and shows the live log with an agent count", () => {
    sse.running = true;
    sse.events = [
      { t: "00:01", kind: "info", msg: "Fetching diff" },
      { t: "00:02", kind: "tool", msg: "read_file src/config.ts" },
    ];
    renderStatus(<RunStatus runIds={["run-1", "run-2"]} />);

    expect(useRunEvents).toHaveBeenCalledWith(["run-1", "run-2"]);
    expect(screen.getByText("Running · 2 agents")).toBeInTheDocument();
    expect(screen.getByText("Fetching diff")).toBeInTheDocument();
    expect(screen.getByText("read_file src/config.ts")).toBeInTheDocument();
  });

  it("uses the singular for one agent", () => {
    sse.running = true;
    renderStatus(<RunStatus runIds={["run-1"]} />);
    expect(screen.getByText("Running · 1 agent")).toBeInTheDocument();
  });

  it("fires onDone once the stream closes after having run — not on a stream that never opened", () => {
    const onDone = vi.fn();
    const { rerender } = renderStatus(<RunStatus runIds={["run-1"]} onDone={onDone} />);
    // Never ran yet: a closed stream on mount is not a completion.
    expect(onDone).not.toHaveBeenCalled();

    sse.running = true;
    rerender(<RunStatus runIds={["run-1"]} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();

    sse.running = false;
    rerender(<RunStatus runIds={["run-1"]} onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
    // The settled log keeps its lines count instead of the running label.
    expect(screen.queryByText(/Running ·/)).not.toBeInTheDocument();
    expect(screen.getByText("0 lines")).toBeInTheDocument();
  });
});
