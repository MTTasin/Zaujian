"use client";

import { useEffect, useState } from "react";
import { TextInput } from "@/components/admin/ui";
import { listHomeCategories } from "@/lib/adminApi";

// The category value a homepage tile points at (matches Product.category so the
// tile's /products?category=… actually lists them).
function tileCategory(link: string, title: string): string {
  if (link) {
    const q = link.split("?")[1];
    if (q) {
      const v = new URLSearchParams(q).get("category");
      if (v) return v;
    }
  }
  return title;
}

// A category text field that suggests the homepage category tiles, so product
// categories stay consistent with the "shop by category" strip.
export default function CategoryInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [cats, setCats] = useState<string[]>([]);

  useEffect(() => {
    listHomeCategories()
      .then((list) => {
        const vals = Array.from(
          new Set(list.map((c) => tileCategory(c.link, c.title)).filter(Boolean)),
        );
        setCats(vals);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <TextInput list="home-category-suggestions" {...props} />
      <datalist id="home-category-suggestions">
        {cats.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </>
  );
}
