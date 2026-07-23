"use client";
import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PriceTag } from "@/components/ui/PriceTag";
import { RatingStars } from "@/components/ui/RatingStars";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Drawer } from "@/components/ui/Drawer";
import { SearchBar } from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";

export default function UiKit() {
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  return (
    <Container>
      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>প্রাইমারি</Button>
          <Button variant="secondary">সেকেন্ডারি</Button>
          <Button variant="ghost">ঘোস্ট</Button>
          <Button disabled>নিষ্ক্রিয়</Button>
        </div>
      </Section>
      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge tone="gold">নতুন</Badge>
          <Badge tone="rose">-20%</Badge>
          <Badge tone="warn">শেষ হয়ে যাচ্ছে</Badge>
          <Badge tone="error">স্টক নেই</Badge>
        </div>
      </Section>
      <Section title="Price + Rating">
        <div className="flex flex-col gap-3">
          <PriceTag price="400" compareAt="500" size="lg" />
          <RatingStars value={4.5} count={23} size="md" />
        </div>
      </Section>
      <Section title="Quantity / Search">
        <div className="flex flex-col gap-4">
          <QuantityStepper value={qty} onChange={setQty} />
          <SearchBar onSubmit={(q) => toast(`খুঁজছি: ${q}`)} />
        </div>
      </Section>
      <Section title="Skeleton / Empty">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="aspect-square" />
          <EmptyState title="কিছু নেই" hint="পরে দেখুন" />
        </div>
      </Section>
      <Section title="Overlays">
        <div className="flex gap-3">
          <Button onClick={() => setOpen(true)}>ড্রয়ার খুলুন</Button>
          <Button variant="secondary" onClick={() => toast("সংরক্ষিত হয়েছে")}>
            টোস্ট
          </Button>
        </div>
        <Drawer open={open} onClose={() => setOpen(false)} title="ফিল্টার">
          <p className="text-muted">ড্রয়ারের ভেতরের কনটেন্ট।</p>
        </Drawer>
      </Section>
    </Container>
  );
}
