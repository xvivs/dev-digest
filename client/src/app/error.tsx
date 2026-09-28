/* Root error boundary — catches render errors from every route below the root
   layout. The layout (and its NextIntlClientProvider + Providers) stays mounted,
   so RouteError can read `common` copy. Errors thrown by the layout itself land
   in global-error.tsx instead. */
"use client";

import { RouteError, type RouteErrorProps } from "@/components/route-error";

export default function RootError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
