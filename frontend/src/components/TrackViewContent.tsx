"use client";
import { useEffect } from "react";
import { metaTrack } from "@/lib/meta";

// Fires a Meta ViewContent when a product page mounts.
export default function TrackViewContent({ name, value }: { name: string; value?: string }) {
  useEffect(() => {
    metaTrack("ViewContent", {
      content_name: name,
      currency: "BDT",
      value: value ? Number(value) : undefined,
    });
  }, [name, value]);
  return null;
}
