"use client";

// Mounts the analytics client and turns App Router navigations into pageviews.
// Storefront only — /admin is the shop owner's own traffic and would pollute
// every number on the dashboard they're looking at.

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { init, trackPageview } from "@/lib/analytics";

function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();   // a ?q= change is a real new pageview

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    init();
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    trackPageview(pathname);
    window.dispatchEvent(new Event("za:pageview"));   // resets scroll milestones
  }, [pathname, params]);

  return null;
}

export default function Analytics() {
  // useSearchParams needs a Suspense boundary or it opts the whole tree into
  // client rendering at build time.
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
