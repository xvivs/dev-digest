import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { renderWithProviders } from "./render";

afterEach(cleanup);

function Probe() {
  const t = useTranslations("demo");
  const qc = useQueryClient();
  const format = useFormatter();
  const retry = qc.getDefaultOptions().queries?.retry;
  return (
    <p>
      {t("hello", { name: "Vlad" })} | retry={String(retry)} |{" "}
      {format.dateTime(new Date("2026-03-05T23:30:00Z"), { hour: "numeric", minute: "numeric" })}
    </p>
  );
}

describe("renderWithProviders", () => {
  it("provides messages, a no-retry QueryClient and a UTC time zone", () => {
    const { queryClient } = renderWithProviders(<Probe />, {
      namespaces: { demo: { hello: "Hi {name}" } },
    });
    expect(screen.getByText("Hi Vlad | retry=false | 11:30 PM")).toBeInTheDocument();
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  it("gives every call a fresh QueryClient unless one is passed", () => {
    const a = renderWithProviders(<p>a</p>).queryClient;
    const b = renderWithProviders(<p>b</p>).queryClient;
    expect(a).not.toBe(b);
    const c = renderWithProviders(<p>c</p>, { queryClient: a }).queryClient;
    expect(c).toBe(a);
  });
});
