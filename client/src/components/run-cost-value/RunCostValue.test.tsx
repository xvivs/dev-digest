import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import costMessages from "../../../messages/en/cost.json";
import { RunCostValue } from "./RunCostValue";

afterEach(cleanup);

function renderCost(props: Partial<React.ComponentProps<typeof RunCostValue>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ cost: costMessages }}>
      <RunCostValue usd={null} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RunCostValue", () => {
  it("renders a provider cost without a tilde, and the exact value in the tooltip", () => {
    renderCost({ usd: 0.0013, source: "provider" });
    const el = screen.getByText("$0.0013");
    expect(el.title).toContain("$0.0013");
  });

  it("renders an estimated cost with a tilde, and an estimate explanation in the tooltip", () => {
    renderCost({ usd: 0.0013, source: "estimated" });
    const el = screen.getByText("~$0.0013");
    expect(el.title).toContain("$0.0013");
    expect(el.title).toMatch(/estimated/i);
  });

  it("renders a dash with the pending reason when the run hasn't finished", () => {
    renderCost({ usd: null, missingReason: "pending" });
    expect(screen.getByText("—").title).toMatch(/in progress/i);
  });

  it("renders a dash with the failed reason when the run errored out", () => {
    renderCost({ usd: null, missingReason: "failed" });
    expect(screen.getByText("—").title).toMatch(/failed/i);
  });

  it("renders a dash with the no_price reason when the model has no price data", () => {
    renderCost({ usd: null, missingReason: "no_price" });
    expect(screen.getByText("—").title).toMatch(/no price/i);
  });
});
