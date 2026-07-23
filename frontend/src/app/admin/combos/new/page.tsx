"use client";

import Link from "next/link";
import ComboEditor from "@/components/admin/ComboEditor";
import { PageHeader } from "@/components/admin/ui";

export default function NewComboPage() {
  return (
    <div>
      <PageHeader
        title="New listing"
        subtitle="A bundle when you link several products, a single item when you link one."
        action={
          <Link href="/admin/combos" className="text-sm font-semibold text-plum hover:underline">
            ← Back to listings
          </Link>
        }
      />
      <ComboEditor />
    </div>
  );
}
