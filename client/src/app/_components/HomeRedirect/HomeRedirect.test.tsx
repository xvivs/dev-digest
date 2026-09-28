import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Repo } from "@devdigest/shared";
import common from "../../../../messages/en/common.json";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));

const useRepos = vi.fn();
vi.mock("@/lib/hooks", () => ({ useRepos: () => useRepos() }));

// The shell pulls in palette, shortcuts and its own queries; it is not under test.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { HomeRedirect } from "./index";

const REPO = { id: "r1", full_name: "acme/api" } as Repo;

// Hand-rolled wrapper: src/test/render.tsx (renderWithProviders) did not exist yet.
function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common }}>
      <HomeRedirect />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
});
afterEach(cleanup);

describe("HomeRedirect", () => {
  it("shows skeletons and does not redirect while loading", () => {
    useRepos.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    renderHome();
    expect(screen.getByRole("heading", { name: "Welcome to DevDigest" })).toBeInTheDocument();
    expect(screen.queryByText("No repositories yet")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers onboarding when there are no repos", () => {
    useRepos.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderHome();
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    expect(push).toHaveBeenCalledWith("/onboarding");
    expect(replace).not.toHaveBeenCalled();
  });

  it("falls back to onboarding when the repo query errors", () => {
    useRepos.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderHome();
    expect(screen.getByText("No repositories yet")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("replaces the URL with the first repo's PR list and offers a manual link", () => {
    useRepos.mockReturnValue({ data: [REPO], isLoading: false, isError: false });
    renderHome();
    expect(replace).toHaveBeenCalledWith("/repos/r1/pulls");
    expect(screen.getByText("Taking you to your repository…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open acme/api" }));
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls");
  });
});
