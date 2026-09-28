/* Last-resort boundary for errors thrown by the root layout itself. It replaces
   that layout, so it renders its own <html>/<body> and gets none of the layout's
   providers: no NextIntlClientProvider, no QueryClient, no theme script.

   Copy: the layout loads messages on the server via next-intl's request config,
   which is unavailable here. We import `common.json` statically and mount a
   provider with just that namespace, so the boundary shows the same copy as
   app/error.tsx with a single source of truth. The locale is hard-coded "en"
   because the app is single-locale (src/i18n/request.ts) and importing that
   module would pull node:fs into the client bundle. */
"use client";

import { NextIntlClientProvider } from "next-intl";
import { RouteError, type RouteErrorProps } from "@/components/route-error";
import common from "../../messages/en/common.json";
import "./globals.css";

export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="en" data-theme="dark" data-density="regular">
      <body>
        <NextIntlClientProvider locale="en" messages={{ common }}>
          <RouteError {...props} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
