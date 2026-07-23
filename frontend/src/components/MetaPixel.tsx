"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { META_PIXEL_ID, captureFbc } from "@/lib/meta";

// Loads the Meta Pixel once and fires PageView on every route change.
// Storefront only (mounted via StoreChrome, which is hidden on /admin).
export default function MetaPixel() {
  const pathname = usePathname();

  useEffect(() => {
    captureFbc();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "PageView");
    }
  }, [pathname]);

  if (!META_PIXEL_ID) return null;

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
    </Script>
  );
}
