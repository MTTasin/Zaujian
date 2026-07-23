// Meta Pixel helpers. The Pixel ID is public (embedded in the browser); the CAPI
// token stays server-side only. Events are deduped with server CAPI via eventID.

export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || "";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

function getCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

// Capture the ad-click id (fbclid) into a `_fbc` cookie so CAPI can attribute
// the conversion to the click. Format: fb.1.<timestamp>.<fbclid>.
export function captureFbc() {
  if (typeof window === "undefined") return;
  const fbclid = new URL(window.location.href).searchParams.get("fbclid");
  if (fbclid && !getCookie("_fbc")) {
    document.cookie = `_fbc=fb.1.${Date.now()}.${fbclid}; max-age=${60 * 60 * 24 * 90}; path=/`;
  }
}

// Attribution data to send with server-side (checkout/custom-request) calls.
export function metaTracking(): { fbp: string; fbc: string; source_url: string } {
  return {
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc"),
    source_url: typeof window !== "undefined" ? window.location.href : "",
  };
}

export function metaTrack(
  event: string,
  params?: Record<string, unknown>,
  opts?: { eventID?: string },
) {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", event, params || {}, opts);
}
