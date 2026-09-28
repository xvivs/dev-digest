import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "../../../messages/en/common.json";
import { RouteError } from "./index";

afterEach(cleanup);

// Hand-rolled wrapper: src/test/render.tsx (renderWithProviders) did not exist yet.
function renderRouteError(error: Error & { digest?: string }, reset = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <RouteError error={error} reset={reset} />
    </NextIntlClientProvider>,
  );
  return { reset };
}

describe("RouteError", () => {
  it("renders as an alert with the title and the error message", () => {
    renderRouteError(new Error("Cannot read properties of undefined"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByText("Cannot read properties of undefined")).toBeInTheDocument();
  });

  it("shows the digest when Next provides one", () => {
    renderRouteError(Object.assign(new Error("boom"), { digest: "abc123" }));
    expect(screen.getByText("Error ID: abc123")).toBeInTheDocument();
  });

  it("omits the digest line when there is none", () => {
    renderRouteError(new Error("boom"));
    expect(screen.queryByText(/Error ID/)).not.toBeInTheDocument();
  });

  it("calls reset when the user retries", () => {
    const { reset } = renderRouteError(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("links home", () => {
    renderRouteError(new Error("boom"));
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });
});
