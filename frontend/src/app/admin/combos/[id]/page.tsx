"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import ComboEditor from "@/components/admin/ComboEditor";
import { PageHeader } from "@/components/admin/ui";

export default function EditComboPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div>
      <PageHeader
        title="Edit listing"
        subtitle="Images, linked items, pictured design and customer questions."
        action={
          <Link href="/admin/combos" className="text-sm font-semibold text-plum hover:underline">
            ← Back to listings
          </Link>
        }
      />
      <ComboEditor comboId={Number(id)} />
    </div>
  );
}
