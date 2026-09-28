import { describe, it, expect, afterEach, vi } from "vitest";
import { act, screen, cleanup, fireEvent } from "@testing-library/react";
import common from "../../messages/en/common.json";
import { renderWithProviders } from "@/test/render";
import { ToastProvider, notify, TOAST_AUTO_DISMISS_MS } from "./toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderToasts() {
  return renderWithProviders(<ToastProvider>{null}</ToastProvider>, { namespaces: { common } });
}

describe("ToastProvider", () => {
  it("shows a toast raised through the notify bridge, dismissable by its translated button", () => {
    renderToasts();
    act(() => notify.error("Could not add repository"));
    expect(screen.getByText("Could not add repository")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: common.toast.dismiss }));
    expect(screen.queryByText("Could not add repository")).not.toBeInTheDocument();
  });

  it("auto-dismisses after TOAST_AUTO_DISMISS_MS", () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => notify.info("Saved"));
    act(() => vi.advanceTimersByTime(TOAST_AUTO_DISMISS_MS - 1));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});
