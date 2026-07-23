"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

// Drag-and-drop OR click image picker. Multiple files supported.
// Keeps a real <input type="file"> in sync so parent <form> FormData still works.
export default function DropZone({
  name,
  label,
  multiple = true,
  required = false,
  resetSignal = 0,
}: {
  name: string;
  label?: string;
  multiple?: boolean;
  required?: boolean;
  resetSignal?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  // Clear when the parent bumps the reset signal (after a successful submit).
  useEffect(() => {
    if (inputRef.current) inputRef.current.value = "";
    setPreviews((old) => {
      old.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
  }, [resetSignal]);

  function apply(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) return;
    // Push dropped files into the real input so the form submits them.
    const dt = new DataTransfer();
    arr.forEach((f) => dt.items.add(f));
    if (inputRef.current) inputRef.current.files = dt.files;
    previews.forEach((u) => URL.revokeObjectURL(u));
    setPreviews(arr.map((f) => URL.createObjectURL(f)));
  }

  return (
    <div className="text-xs">
      {label && <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); apply(e.dataTransfer.files); }}
        className={cn(
          "flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 text-center transition",
          drag ? "border-plum bg-plum/5" : "border-slate-300 bg-slate-50 hover:bg-slate-100",
        )}
      >
        {previews.length > 0 ? (
          <div className="flex flex-wrap justify-center gap-1">
            {previews.map((u) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={u} src={u} alt="" className="h-14 w-14 rounded object-cover" />
            ))}
          </div>
        ) : (
          <span className="flex flex-col items-center gap-1 text-slate-400">
            <Icon name="upload" size={20} />
            <span>Drag &amp; drop or click to choose{multiple ? " (multiple)" : ""}</span>
          </span>
        )}
        {previews.length > 0 && <span className="mt-1 font-semibold text-plum">{previews.length} selected</span>}
      </div>
      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        multiple={multiple}
        required={required}
        onChange={(e) => e.target.files && apply(e.target.files)}
        className="hidden"
      />
    </div>
  );
}
