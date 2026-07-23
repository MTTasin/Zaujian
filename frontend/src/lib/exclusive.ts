import type { ProductListItem } from "./api";

/**
 * Toggle `product` in `selected`, enforcing "only one per exclusive group".
 * Returns a NEW Set — never mutates the input.
 */
export function applyExclusive(
  selected: Set<string>,
  product: ProductListItem,
  all: ProductListItem[],
): Set<string> {
  const next = new Set(selected);
  if (next.has(product.slug)) {
    next.delete(product.slug);
    return next;
  }
  const group = product.exclusive_group;
  if (group) {
    // Auto-swap: drop any other selected product from the same group.
    for (const other of all) {
      if (other.slug !== product.slug && other.exclusive_group === group) {
        next.delete(other.slug);
      }
    }
  }
  next.add(product.slug);
  return next;
}

/** Product NAMES per exclusive group that has 2+ members — for the Bengali rule note. */
export function exclusiveGroups(all: ProductListItem[]): string[][] {
  const byGroup = new Map<string, string[]>();
  for (const p of all) {
    if (!p.exclusive_group) continue;
    const names = byGroup.get(p.exclusive_group) ?? [];
    names.push(p.name);
    byGroup.set(p.exclusive_group, names);
  }
  return [...byGroup.values()].filter((names) => names.length > 1);
}
