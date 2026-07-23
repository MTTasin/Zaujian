"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";

// Storefront drag-and-drop image picker with live previews (Heritage Atelier).
export function ImageDropzone({
  files,
  onChange,
  max = 6,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function add(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    onChange([...files, ...imgs].slice(0, max));
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          drag ? "border-plum bg-plum/5" : "border-border bg-surface-2 hover:border-plum/40"
        }`}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-gold shadow-sm">
          <Icon name="upload" size={20} />
        </span>
        <p className="text-sm font-semibold text-foreground">
          ছবি টেনে আনুন, বা চাপ দিয়ে বেছে নিন
        </p>
        <p className="text-xs text-muted">সর্বোচ্চ {max} টি ছবি</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { add(e.target.files); e.target.value = ""; }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt={`নমুনা ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(files.filter((_, idx) => idx !== i)); }}
                aria-label="মুছুন"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-wine/85 text-white shadow transition hover:bg-wine"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
