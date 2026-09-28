import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer (replaces prototype mdLite). Inline + GFM.
 *
 * Block elements (headings, lists, quotes, code blocks) get explicit styles:
 * the global reset and Tailwind's preflight strip heading sizes and list
 * markers, so without them `#`/`-` render as plain paragraphs.
 *
 * `safe` is an opt-in hardening mode for untrusted bodies (imported/unvetted
 * skills, SPEC-02 ADR 0012): images render as a plain link instead of loading
 * (`![](https://…)` never fetches), and links open in a new tab with
 * `rel="noopener noreferrer"`. `urlTransform` is left at react-markdown's
 * default in both modes — it already drops `javascript:` URLs.
 *
 * Renderers live at module level so react-markdown gets stable component
 * types across renders (no remount of the rendered tree).
 */

const heading = {
  color: "var(--text-primary)",
  fontWeight: 650,
  lineHeight: 1.3,
} as const;

const link = { color: "var(--accent-text)", textDecoration: "underline" } as const;

/** Plain text of a hast subtree. A fenced block is `pre > code > text`; `pre`
 *  renders that text itself so the inline `code` chip styling stays out. */
type HastNode = { type: string; value?: string; children?: HastNode[] };
function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const baseComponents: Components = {
  h1: ({ children }) => <h1 style={{ ...heading, fontSize: "1.3em", margin: "0 0 12px" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ ...heading, fontSize: "1.1em", margin: "18px 0 8px" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ ...heading, fontSize: "1em", margin: "14px 0 6px" }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ ...heading, fontSize: "0.95em", margin: "12px 0 6px" }}>{children}</h4>,
  p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: "0 0 10px", paddingLeft: 20, listStyle: "disc" }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 10px", paddingLeft: 20, listStyle: "decimal" }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: "3px 0" }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0 0 10px",
        padding: "2px 12px",
        borderLeft: "3px solid var(--border-strong)",
        color: "var(--text-muted)",
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "14px 0" }} />,
  pre: ({ node }) => (
    <pre
      className="mono"
      style={{
        margin: "0 0 10px",
        padding: "10px 12px",
        borderRadius: 6,
        background: "var(--bg-hover)",
        overflowX: "auto",
        fontSize: "0.92em",
      }}
    >
      <code>{hastText(node as HastNode | undefined)}</code>
    </pre>
  ),
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
    <a href={href} style={link}>
      {children}
    </a>
  ),
};

const safeComponents: Components = {
  ...baseComponents,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" style={link}>
      {children}
    </a>
  ),
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? src : undefined;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mono" style={link}>
        {/* Show the real destination next to the alt text, so an imported
            body can't hide where the link points. */}
        {alt ? `${alt} (${url ?? "image"})` : (url ?? "image")}
      </a>
    );
  },
};

export function Markdown({ children, safe }: { children?: string | null; safe?: boolean }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={safe ? safeComponents : baseComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
