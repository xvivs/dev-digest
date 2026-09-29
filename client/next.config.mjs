import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  webpack(config) {
    // The vendored @devdigest/shared barrel re-exports siblings with `.js`
    // specifiers (ESM-style, resolved to `.ts` by tsc and vite). Webpack needs
    // the alias before a hook can import a zod schema as a VALUE, which
    // ADR 0007 (response validation) requires. Without it every route 500s
    // while tsc and vitest stay green (client/INSIGHTS.md).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
