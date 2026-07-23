"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/Icon";

export function SearchBar({
  defaultValue = "",
  onSubmit,
  placeholder = "খুঁজুন...",
  className,
}: {
  defaultValue?: string;
  onSubmit: (q: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) onSubmit(q);
  };
  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex items-center gap-2 rounded-full border border-border bg-surface px-4",
        className,
      )}
    >
      <input
        type="search"
        aria-label="খুঁজুন"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        aria-label="খুঁজুন"
        className="flex h-12 cursor-pointer items-center text-plum"
      >
        <Icon name="search" size={20} />
      </button>
    </form>
  );
}
