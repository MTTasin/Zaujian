"use client";

// Reports a storefront search and how many results it returned. Zero-result
// searches are the point: they are demand the shop isn't serving yet, and they
// surface in the admin dashboard as "empty searches".
//
// A component (not a hook call in the page) because /products is a server
// component — it knows the term and the result count, but can't fire a browser event.

import { useEffect } from "react";
import { trackSearch } from "@/lib/analytics";

export default function SearchTracker({ term, results }: { term: string; results: number }) {
  useEffect(() => {
    const q = term.trim();
    if (q) trackSearch(q, results);
  }, [term, results]);

  return null;
}
