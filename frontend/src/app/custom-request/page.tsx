"use client";

import Link from "next/link";
import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";
import { ImageDropzone } from "@/components/ui/ImageDropzone";
import { submitCustomRequest } from "@/lib/api";
import { metaTrack, metaTracking } from "@/lib/meta";

// Standalone custom-order request (plan §8): description + reference images.
export default function CustomRequestPage() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      files.forEach((f) => fd.append("images", f));
      const leadEventId = `lead.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
      const t = metaTracking();
      fd.append("fbp", t.fbp);
      fd.append("fbc", t.fbc);
      fd.append("source_url", t.source_url);
      fd.append("lead_event_id", leadEventId);
      await submitCustomRequest(fd);
      metaTrack("Lead", {}, { eventID: leadEventId });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "সমস্যা হয়েছে");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Container className="py-8 lg:py-12">
        <div className="mx-auto w-full max-w-lg">
          <div className="flex justify-center">
            <Eyebrow>কাস্টম অর্ডার</Eyebrow>
          </div>
          <h1 className="mt-2 text-center font-display text-2xl font-semibold text-plum sm:text-3xl">
            নিজের ডিজাইনে অর্ডার
          </h1>

          {/* Customers were reaching this page without knowing what it was for,
              so say it plainly before the form: what it is, and what happens next. */}
          {!done && (
            <>
              <p className="mt-3 text-center text-base leading-relaxed text-muted">
                আমাদের তালিকায় নেই এমন কিছু বানাতে চান? নিজের আঁকা ডিজাইন, ভিন্ন মাপ,
                বা অন্য কোথাও দেখা কোনো নকশা — ছবি আর বর্ণনা পাঠান, আমরা বানিয়ে দেব।
              </p>
              <ol className="mt-5 space-y-3 rounded-2xl bg-surface-2 p-5">
                {[
                  "কী বানাতে চান লিখুন, সাথে নমুনা ছবি দিন",
                  "আমরা দেখে ফোনে দাম জানাব",
                  "আপনি রাজি হলে বানানো শুরু — আগে টাকা লাগবে না",
                ].map((step, i) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-foreground">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-plum text-sm font-semibold text-white">
                      {i + 1}
                    </span>
                    <span className="pt-1 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {done ? (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl bg-surface-2 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/12 text-success">
                <Icon name="check" size={28} />
              </span>
              <p className="font-display text-lg font-semibold text-foreground">
                আপনার অনুরোধ পেয়েছি
              </p>
              <p className="text-sm text-muted">আমরা শীঘ্রই দাম জানিয়ে যোগাযোগ করব।</p>
              <Link
                href="/"
                className="mt-3 inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98]"
              >
                হোমে ফিরুন
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-6 space-y-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border"
            >
              <Field label="আপনার নাম" name="customer_name" required />
              <Field label="মোবাইল নম্বর" name="phone" type="tel" required />
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-foreground">
                  কী বানাতে চান লিখুন
                </label>
                <textarea
                  name="description"
                  rows={4}
                  required
                  className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-foreground">
                  নমুনা ছবি (থাকলে)
                </label>
                <ImageDropzone files={files} onChange={setFiles} />
              </div>
              {error && <p className="text-center text-sm text-error">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98] disabled:opacity-50"
              >
                <Icon name="sparkles" size={18} /> {busy ? "পাঠানো হচ্ছে..." : "অনুরোধ পাঠান"}
              </button>
            </form>
          )}
        </div>
      </Container>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-foreground">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base outline-none focus:border-plum"
      />
    </div>
  );
}
