"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";

export default function TrackLanding() {
  const [code, setCode] = useState("");
  const router = useRouter();

  function go(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) router.push(`/track/${c}`);
  }

  return (
    <div className="flex flex-1 flex-col">
      <Container className="flex flex-1 items-center justify-center py-14">
        <div className="w-full max-w-md">
          <div className="flex justify-center">
            <Eyebrow>অর্ডার ট্র্যাকিং</Eyebrow>
          </div>
          <h1 className="mt-2 text-center font-display text-2xl font-semibold text-plum sm:text-3xl">
            অর্ডার ট্র্যাক করুন
          </h1>
          <p className="mt-2 text-center text-sm text-muted">
            আপনার অর্ডার কোড দিন (ইমেইলে পাঠানো হয়েছে)।
          </p>

          <form onSubmit={go} className="mt-6 space-y-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-foreground">
                অর্ডার কোড
              </label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="যেমন AB12CD"
                className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-center text-lg font-semibold uppercase tracking-widest outline-none focus:border-plum"
              />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98]"
            >
              <Icon name="search" size={18} /> দেখুন
            </button>
          </form>
        </div>
      </Container>
    </div>
  );
}
