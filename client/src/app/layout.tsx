import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "../lib/providers";
import { themeNoFlashScript } from "../lib/theme";

export const metadata: Metadata = {
  // Route pages (Server Components) export `metadata = { title: "Pull requests" }`
  // and get "Pull requests · DevDigest"; pages without a title get the default.
  title: { default: "DevDigest", template: "%s · DevDigest" },
  description: "Local-first AI PR review tool",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} data-theme="dark" data-density="regular" suppressHydrationWarning>
      <head>
        {/* set theme before paint to avoid FOUC */}
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, translators, …)
          inject attributes like data-gr-ext-installed onto <body> before React
          hydrates. This suppresses ONLY this element's own attribute mismatch
          (one level deep) — real mismatches in descendants are still reported. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Root Suspense boundary. Kept: it is the bailout target for any
              useSearchParams() consumer on a statically prerendered route. Narrow
              it only after each consumer has its own local <Suspense>. No root
              loading.tsx: every page renders its own AppShell, so a route-level
              fallback would blank the shell on each client navigation. */}
          <Suspense fallback={null}>
            <Providers>{children}</Providers>
          </Suspense>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
