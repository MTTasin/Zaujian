import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";

// Shared shell for static legal pages (privacy, terms). Bengali-first, readable.
export default function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <Container className="py-8 lg:py-12">
        <div className="mx-auto w-full max-w-2xl">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-2 font-display text-2xl font-semibold text-plum sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 text-sm text-muted">সর্বশেষ আপডেট: {updated}</p>
          <div className="legal-prose mt-6 space-y-6 text-[15px] leading-relaxed text-foreground">
            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}

// A titled section block used inside legal pages.
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-semibold text-plum">{heading}</h2>
      <div className="space-y-2 text-muted">{children}</div>
    </section>
  );
}
