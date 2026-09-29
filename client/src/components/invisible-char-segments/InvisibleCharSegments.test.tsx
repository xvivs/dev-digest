import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { splitInvisibleChars } from "@/lib/invisible-chars";
import { InvisibleCharSegments } from "./InvisibleCharSegments";

afterEach(cleanup);

describe("InvisibleCharSegments", () => {
  it("renders printable runs as text and flags each invisible character with its code point", () => {
    const { container } = render(<InvisibleCharSegments segments={splitInvisibleChars("a​b‮c")} />);
    expect(container.textContent).toBe("a[U+200B]b[U+202E]c");
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(screen.getByTitle("U+202E")).toBeInTheDocument();
  });

  it("renders a clean body without marks", () => {
    const { container } = render(<InvisibleCharSegments segments={splitInvisibleChars("plain")} />);
    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("plain");
  });
});
