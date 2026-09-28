import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer (replaces prototype mdLite). Inline + GFM.
 *
 * `safe` is an opt-in hardening mode for untrusted bodies (imported/unvetted
 * skills, SPEC-02 ADR 0012): images render as a plain link instead of loading
 * (`![](https://…)` never fetches), and links open in a new tab with
 * `rel="noopener noreferrer"`. `urlTransform` is left at react-markdown's
 * default in both modes — it already drops `javascript:` URLs.
 */
export function Markdown({ children, safe }: { children?: string | null; safe?: boolean }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target={safe ? "_blank" : undefined}
              rel={safe ? "noopener noreferrer" : undefined}
              style={{
                color: "var(--accent-text)",
                textDecoration: "underline",
              }}
            >
              {children}
            </a>
          ),
          ...(safe
            ? {
                img: ({ src, alt }) => (
                  <a
                    href={typeof src === "string" ? src : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono"
                    style={{
                      color: "var(--accent-text)",
                      textDecoration: "underline",
                    }}
                  >
                    {/* Show the real destination next to the alt text, so an
                        imported body can't hide where the link points. */}
                    {alt
                      ? `${alt} (${typeof src === "string" ? src : "image"})`
                      : typeof src === "string"
                        ? src
                        : "image"}
                  </a>
                ),
              }
            : {}),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
