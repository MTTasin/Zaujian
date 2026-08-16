"use client";

import Link from "next/link";
import Image from "next/image";
import { Galada } from "next/font/google";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminGet, type AdminOrder } from "@/lib/adminApi";
import { AdminButton, Loading } from "@/components/admin/ui";

// Printed on every challan. Steadfast merchant account id — env-overridable so a
// new account needs a rebuild, not a code edit.
const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || "F5G6HMWE";
const MERCHANT_NAME = "Zaujain Nikah Point";

// Galada is used for the merchant name alone — nowhere else on the challan, and
// nowhere else in the app (kept out of layout.tsx so the storefront never pays
// for it on 2G).
const galada = Galada({ subsets: ["latin"], weight: "400", display: "swap" });

export default function ChallanPage() {
  const { id } = useParams<{ id: string }>();
  const extraId = useSearchParams().get("extra");
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminGet<AdminOrder>(`orders/${id}/`).then(setOrder).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-600">{error}</p>;
  if (!order) return <Loading />;

  // An additional consignment prints its own recipient/parcel; else the order's.
  const extra = extraId ? order.extra_consignments.find((e) => String(e.id) === extraId) : null;
  const parcelId = extra
    ? extra.consignment_id || extra.invoice
    : order.steadfast_consignment_id || order.uid;
  const phone = extra ? extra.recipient_phone || order.phone : order.phone;
  const customerName = extra ? extra.recipient_name || order.customer_name : order.customer_name;
  const item = extra
    ? extra.item_description ||
      order.items.map((i) => i.product_name).filter(Boolean).join(", ") ||
      "Nikah items"
    : order.items.map((i) => i.product_name).filter(Boolean).join(", ") || "Nikah items";

  return (
    <div>
      {/* Controls (not printed) */}
      <div className="mb-5 flex items-center gap-3 print:hidden">
        <AdminButton icon="upload" onClick={() => window.print()}>Print challan</AdminButton>
        <Link href={`/admin/orders/${id}`} className="text-sm font-medium text-plum hover:underline">
          ← Back to order
        </Link>
      </div>

      {/* Sticker — a full A4 page (210×297mm minus the 6mm print margin).
          Height is 283mm, not the full 285mm printable height: an exact fit
          leaves zero slack, so sub-pixel rounding spills onto a second sheet. */}
      <div
        className="challan-sheet relative mx-auto flex max-w-full flex-col overflow-hidden bg-white px-10 pt-10 pb-0"
        style={{ fontFamily: "'Times New Roman', Times, serif", width: "198mm", height: "283mm" }}
      >
        {/* Brand watermark, sitting behind the address block. */}
        <div className="pointer-events-none absolute left-0 right-0 top-4 flex justify-center">
          <Image src="/Logo.png" alt="" width={620} height={620} className="opacity-20" priority />
        </div>

        <div className="relative space-y-2">
          <ChallanRow
            label="Merchant Name:"
            value={MERCHANT_NAME}
            variant="plain"
            valueClass={`${galada.className} not-italic leading-[1.45]`}
          />
          <ChallanRow label="Merchant ID:" value={MERCHANT_ID} variant="plain-mono" />
          <ChallanRow label="Parcel ID:" value={parcelId} variant="huge" />
          <ChallanRow label="Customer Mobile:" value={phone} variant="small-label" />
          <ChallanRow label="Customer Name:" value={customerName} variant="small-label" />

          <div className="flex items-center gap-3 pt-1">
            <span className="shrink-0 text-5xl text-slate-900">Item:</span>
            <span className="flex-1 rounded-2xl bg-slate-200/80 px-5 py-3 text-center text-2xl font-bold leading-snug text-slate-900">
              {item}
            </span>
          </div>
        </div>

        {/* Fragile warning — the black band bleeds edge to edge, the plaque sits on it. */}
        <div
          className="relative flex items-center justify-center"
          style={{ marginTop: "42mm" }}
        >
          <div className="absolute inset-x-[-40px] h-[76px] bg-black" />
          <DangerPlaque />
        </div>
      </div>
    </div>
  );
}

function ChallanRow({
  label,
  value,
  variant,
  valueClass = "",
}: {
  label: string;
  value: string;
  variant: "plain" | "plain-mono" | "huge" | "small-label";
  valueClass?: string;
}) {
  const labelCls = variant === "small-label" ? "text-xl" : "text-4xl";
  const plain = variant === "plain" || variant === "plain-mono";
  const valueCls = {
    plain: "text-4xl font-bold italic",
    "plain-mono": "text-4xl font-bold tracking-wider",
    huge: "text-6xl font-extrabold tracking-wide",
    "small-label": "text-3xl font-bold",
  }[variant];

  return (
    <div className="flex items-center gap-3">
      <span className={`shrink-0 text-slate-800 ${labelCls}`}>{label}</span>
      <span
        className={
          plain
            ? `flex-1 px-5 text-center text-slate-900 ${valueCls} ${valueClass}`
            : `flex-1 rounded-2xl bg-slate-200/80 px-5 py-1.5 text-center text-slate-900 ${valueCls} ${valueClass}`
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * "DANGER — GLASS ITEM" plaque: an amber sign plate bolted at four corners, with
 * the standard skull-and-crossbones hazard triangle. Drawn inline (SVG + CSS) so
 * it prints crisp at any size and needs no image asset.
 */
function DangerPlaque() {
  return (
    <div
      className="relative rounded-[22px] border-[6px] border-black px-8 pb-6 pt-5 shadow-[0_8px_0_rgba(0,0,0,.35)]"
      style={{
        width: "68%",
        background: "linear-gradient(180deg,#fdc23a 0%,#f7a81b 55%,#f19307 100%)",
      }}
    >
      {/* Corner bolts */}
      <span className="absolute left-3 top-3 h-5 w-5 rounded-full bg-black" />
      <span className="absolute right-3 top-3 h-5 w-5 rounded-full bg-black" />
      <span className="absolute bottom-3 left-3 h-5 w-5 rounded-full bg-black" />
      <span className="absolute bottom-3 right-3 h-5 w-5 rounded-full bg-black" />

      <div className="flex flex-col items-center gap-3">
        <HazardTriangle />
        <div className="w-full rounded-md bg-black px-6 py-1 text-center">
          <span
            className="text-5xl font-bold tracking-[0.12em]"
            style={{ color: "#f5c451" }}
          >
            DANGER
          </span>
        </div>
        <span className="text-5xl font-bold tracking-[0.06em] text-black">GLASS ITEM</span>
      </div>
    </div>
  );
}

function HazardTriangle() {
  return (
    <svg viewBox="0 0 200 180" className="h-[120px] w-[132px]" role="img" aria-label="Fragile — glass">
      <defs>
        {/* Skull drawn as a mask so the eyes/nose/teeth are cut out of solid black. */}
        <mask id="challan-skull">
          <rect width="200" height="180" fill="black" />
          {/* cranium + jaw silhouette */}
          <ellipse cx="100" cy="96" rx="27" ry="24" fill="white" />
          <rect x="86" y="110" width="28" height="19" rx="7" fill="white" />
          {/* eye sockets */}
          <ellipse cx="90" cy="93" rx="8.5" ry="10" fill="black" />
          <ellipse cx="110" cy="93" rx="8.5" ry="10" fill="black" />
          {/* nose */}
          <path d="M100 103 l5 9 h-10 z" fill="black" />
          {/* teeth gaps */}
          <rect x="95.5" y="114" width="2.6" height="13" fill="black" />
          <rect x="101.9" y="114" width="2.6" height="13" fill="black" />
        </mask>
      </defs>

      {/* Warning triangle */}
      <path
        d="M100 12 L190 166 H10 Z"
        fill="none"
        stroke="#000"
        strokeWidth="13"
        strokeLinejoin="round"
      />

      {/* Crossbones behind the skull */}
      <g fill="#000">
        {[34, -34].map((deg) => (
          <g key={deg} transform={`translate(100 128) rotate(${deg})`}>
            <rect x="-46" y="-5" width="92" height="10" rx="5" />
            <circle cx="-46" cy="-6" r="7.5" />
            <circle cx="-46" cy="6" r="7.5" />
            <circle cx="46" cy="-6" r="7.5" />
            <circle cx="46" cy="6" r="7.5" />
          </g>
        ))}
      </g>

      <rect width="200" height="180" fill="#000" mask="url(#challan-skull)" />
    </svg>
  );
}
