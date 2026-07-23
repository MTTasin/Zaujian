import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Icon } from "@/components/ui/Icon";

export default function NotFound() {
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <div className="flex justify-center">
        <Eyebrow>৪০৪</Eyebrow>
      </div>
      <h1 className="mt-3 font-display text-4xl font-semibold text-plum sm:text-5xl">
        পৃষ্ঠাটি পাওয়া যায়নি
      </h1>
      <p className="mt-3 max-w-md text-muted">
        দুঃখিত, আপনি যে পৃষ্ঠাটি খুঁজছেন সেটি নেই বা সরিয়ে ফেলা হয়েছে।
      </p>
      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row">
        <Link
          href="/"
          className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-plum px-8 text-base font-semibold text-white transition hover:bg-wine active:scale-[0.98]"
        >
          <Icon name="home" size={18} /> হোমে ফিরুন
        </Link>
        <Link
          href="/products"
          className="inline-flex min-h-14 items-center justify-center rounded-full border border-plum/25 px-8 text-base font-semibold text-plum transition hover:border-plum active:scale-[0.98]"
        >
          সব পণ্য দেখুন
        </Link>
      </div>
    </Container>
  );
}
