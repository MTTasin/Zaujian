"use client";

import Link from "next/link";
import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminGet, type AdminOrder } from "@/lib/adminApi";
import { AdminButton, Loading } from "@/components/admin/ui";

export default function ChallanPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminGet<AdminOrder>(`orders/${id}/`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!order) return <Loading />;

  const parcelId = order.steadfast_consignment_id || order.uid;
  const item =
    order.items.map((i) => i.product_name).filter(Boolean).join(", ") || "Nikah items";

  return (
    <div>
      {/* Controls (not printed) */}
      <div className="mb-5 flex items-center gap-3 print:hidden">
        <AdminButton icon="upload" onClick={() => window.print()}>Print challan</AdminButton>
        <Link href={`/admin/orders/${id}`} className="text-sm font-medium text-plum hover:underline">
          ← Back to order
        </Link>
      </div>

      {/* Sticker — one third of an A4 page (so 3 fit per sheet) */}
      <div
        className="challan-sheet relative mx-auto flex max-w-full flex-col justify-center overflow-hidden border-2 border-slate-800 bg-white px-6 py-3"
        style={{ fontFamily: "'Times New Roman', Times, serif", width: "190mm", height: "95mm" }}
      >
        {/* Brand watermark */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Image src="/Logo.png" alt="" width={520} height={520} className="opacity-20" />
        </div>

        <div className="relative space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl text-slate-800">Merchant Name:</span>
            <span className="text-2xl font-bold italic text-slate-900">Zaujain Nikah Point</span>
          </div>

          <ChallanRow label="Parcel ID:" value={parcelId} size="xl" />
          <ChallanRow label="Customer Mobile:" value={order.phone} size="lg" />
          <ChallanRow label="Customer Name:" value={order.customer_name} size="lg" />

          <div className="flex items-center gap-3">
            <span className="shrink-0 text-3xl text-slate-900">Item:</span>
            <span className="flex-1 rounded-xl bg-slate-200/80 px-4 py-1.5 text-center text-2xl font-bold text-slate-900">
              {item}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChallanRow({
  label,
  value,
  size,
}: {
  label: string;
  value: string;
  size: "xl" | "lg";
}) {
  const val = size === "xl" ? "text-5xl font-extrabold tracking-wide" : "text-2xl font-bold";
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-2xl text-slate-800">{label}</span>
      <span className={`flex-1 rounded-xl bg-slate-200/80 px-4 py-1.5 text-center text-slate-900 ${val}`}>
        {value}
      </span>
    </div>
  );
}
