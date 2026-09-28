import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import common from "../../messages/en/common.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import NotFound from "./not-found";

afterEach(cleanup);

describe("root not-found", () => {
  it("renders the 404 copy and sends the user home", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ common }}>
        <NotFound />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go home" }));
    expect(push).toHaveBeenCalledWith("/");
  });
});
