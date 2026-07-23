import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import LayeredConfigurator from "./LayeredConfigurator";
import type { ProductDetail } from "@/lib/api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  addToCart: vi.fn(),
  editCartItem: vi.fn(),
  mediaUrl: (u?: string | null) => u ?? "",
}));

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 1, name: "নিকাহ নামা বুক", slug: "book", kind: "layered",
    category: "", base_price: "1100", exclusive_group: "", customize_order: 0,
    compare_at_price: null, allows_individual_purchase: true,
    is_featured: false, is_popular: false, stock: 0, track_stock: false,
    in_stock: true, is_customizable: true, thumbnail: null,
    min_price: "1100", max_price: "1400",
    preview_ratio: "1 / 1", description: "", images: [], specs: [],
    input_fields: [],
    colors: [{ id: 10, name: "মেরুন", base_image: "/c.jpg", price_modifier: "0" }],
    toppings: [], inside_designs: [], static_designs: [],
    dupatta_options: [], config_images: [],
    ...overrides,
  };
}

const inside = [{ id: 20, price_modifier: "0", preview_image: "/i.jpg" }];

describe("LayeredConfigurator inside-page step", () => {
  it("offers the inside step whenever the product has inside designs", () => {
    // Regression: this used to be gated on `category === "book"` — a free-text
    // admin label — so typing "বই" silently dropped the whole step.
    render(<LayeredConfigurator product={product({ inside_designs: inside })} />);
    expect(screen.getByText(/পরবর্তী/)).toBeInTheDocument();
  });

  it("still offers it when the category label is Bengali or empty", () => {
    for (const category of ["বই", "", "Book", "nikah-book"]) {
      const { unmount } = render(
        <LayeredConfigurator product={product({ category, inside_designs: inside })} />,
      );
      expect(screen.getByText(/পরবর্তী/), `category=${category}`).toBeInTheDocument();
      unmount();
    }
  });

  it("goes straight to add-to-cart when there are no inside designs", () => {
    render(<LayeredConfigurator product={product({ category: "book" })} />);
    expect(screen.queryByText(/পরবর্তী/)).not.toBeInTheDocument();
    expect(screen.getByText("কার্টে যোগ করুন")).toBeInTheDocument();
  });
});
