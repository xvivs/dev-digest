import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  webpack: (config) => {
    // The vendored `@devdigest/shared` contracts import siblings with NodeNext
    // `.js` specifiers (`./findings.js` → findings.ts). Without this alias a
    // VALUE import of a contract schema (ADR 0007 response validation) 500s
    // every route in `next dev` while tsc and vitest stay green.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
