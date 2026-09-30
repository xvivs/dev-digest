import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { splitInvisibleChars } from "@/lib/invisible-chars";
import { InvisibleCharSegments } from "./InvisibleCharSegments";

afterEach(cleanup);

describe("InvisibleCharSegments", () => {
  it("renders printable runs as text and flags each invisible character with its code point", () => {
    render(
      <p data-testid="body">
        <InvisibleCharSegments segments={splitInvisibleChars("a​b‮c")} />
      </p>,
    );
    expect(screen.getByTestId("body")).toHaveTextContent("a[U+200B]b[U+202E]c");
    expect(screen.getAllByTitle(/^U\+/)).toHaveLength(2);
    expect(screen.getByTitle("U+202E")).toHaveTextContent("[U+202E]");
  });

  it("renders a clean body without marks", () => {
    render(
      <p data-testid="body">
        <InvisibleCharSegments segments={splitInvisibleChars("plain")} />
      </p>,
    );
    expect(screen.queryByTitle(/^U\+/)).not.toBeInTheDocument();
    expect(screen.getByTestId("body")).toHaveTextContent(/^plain$/);
  });
});
