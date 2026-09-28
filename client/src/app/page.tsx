/* Root — thin route; the redirect / onboarding logic lives in HomeRedirect. */
import { HomeRedirect } from "./_components/HomeRedirect";

export default function HomePage() {
  return <HomeRedirect />;
}
