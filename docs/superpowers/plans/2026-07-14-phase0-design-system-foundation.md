# Phase 0 — Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw pink→purple identity with a premium-editorial design system — tokens, fonts, a tested shared component library, and a new site shell/header/footer — with zero change to storefront features or backend.

**Architecture:** Front-end only. Rewrite `globals.css` theme tokens and layout fonts, add a Vitest + React Testing Library setup, then build a focused `components/ui/` library (primitives + layout + overlays), a new `SiteHeader`/`SiteFooter`/`MobileTabBar` shell, re-skin the chat widget to the new tokens, and add a dev-only `/ui-kit` preview page. Existing pages keep working; they are re-skinned in later phases.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19.2.4, TypeScript 5, Tailwind CSS v4 (`@theme inline`, no config file), `next/font/google` (Noto Serif Bengali + Hind Siliguri), Vitest + @testing-library/react + jsdom for tests.

## Global Constraints

- **Storefront is Bengali only**; admin is English. All customer-facing copy in this plan is Bengali.
- **Mobile-first, huge tap targets (min 48px), image-first, 2G-friendly.** Keep JS/CSS lean; lazy-load; respect `prefers-reduced-motion`.
- **Light theme only** (per CLAUDE.md). No dark mode in Phase 0.
- **Money is never a float in any code path** — this phase renders prices from strings only (Django sends Decimal as string); never parse to `Number` for math.
- **Next.js 16 has breaking changes vs training data.** Before writing any Next-specific code (fonts, `Link`, `Image`, layout, route files), read the relevant guide under `frontend/node_modules/next/dist/docs/01-app/` and heed deprecation notices (per `frontend/AGENTS.md`).
- **Tailwind v4:** theme is defined in `frontend/src/app/globals.css` via `@theme inline` — there is no `tailwind.config.*`. Add design tokens as CSS variables mapped through `@theme inline`.
- All commands run from `frontend/` unless stated. Do **not** run any `git` command that stages or commits backend/frontend source outside this plan's scope; commit only the files each task lists.

---

### Task 1: Test tooling (Vitest + React Testing Library)

No test runner exists yet. Set one up so every later component task is TDD.

**Files:**
- Modify: `frontend/package.json` (add devDeps + `test` script)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/lib/cn.ts`
- Test: `frontend/src/lib/cn.test.ts`

**Interfaces:**
- Produces: `cn(...classes: (string | false | null | undefined)[]): string` — joins truthy class strings with a single space. Every UI component uses it to merge class names.

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
npm install -D vitest@^2 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 jsdom@^25 @vitejs/plugin-react@^4
```
Expected: installs without peer-dep errors (React 19 is supported by @testing-library/react 16).

- [ ] **Step 2: Add the test script**

Edit `frontend/package.json` `scripts` to add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create the Vitest config**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 4: Create the setup file**

Create `frontend/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Write the failing test for `cn`**

Create `frontend/src/lib/cn.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class strings with single spaces", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("drops falsy values", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("returns empty string when nothing truthy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
```

- [ ] **Step 6: Run it and confirm failure**

Run: `npm test -- src/lib/cn.test.ts`
Expected: FAIL — `Cannot find module './cn'`.

- [ ] **Step 7: Implement `cn`**

Create `frontend/src/lib/cn.ts`:
```ts
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
```

- [ ] **Step 8: Run it and confirm pass**

Run: `npm test -- src/lib/cn.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/vitest.setup.ts frontend/src/lib/cn.ts frontend/src/lib/cn.test.ts
git commit -m "chore: add vitest + testing-library and cn helper"
```

---

### Task 2: Premium design tokens + fonts

Replace the pink/purple tokens with the premium-editorial palette and wire the two Bengali fonts. Existing `.brand-gradient` / `.brand-gradient-text` class names are **kept** (many pages reference them) but re-pointed to rose→plum.

**Files:**
- Modify: `frontend/src/app/globals.css` (full rewrite of tokens + theme)
- Modify: `frontend/src/app/layout.tsx` (add display font, keep body font)

**Interfaces:**
- Produces: Tailwind color utilities `bg-background surface surface-2 foreground muted plum rose gold border success warn error` and font utilities `font-sans` (body = Hind Siliguri) + `font-display` (headings = Noto Serif Bengali). CSS classes `.brand-gradient`, `.brand-gradient-text` (rose→plum). All later components consume these.

- [ ] **Step 1: Read the Next 16 fonts guide**

Run: `ls frontend/node_modules/next/dist/docs/01-app/` and open the font/optimization guide.
Expected: confirm `next/font/google` usage for Next 16 (multiple fonts, `variable` export). Note any deprecations.

- [ ] **Step 2: Rewrite the theme tokens**

Replace the entire contents of `frontend/src/app/globals.css` with:
```css
@import "tailwindcss";

/* Premium-editorial light theme. Plum + rose + gold on warm cream. */
:root {
  --background: #fbf7f2;   /* cream */
  --surface: #ffffff;
  --surface-2: #f4eee7;    /* warm panel */
  --foreground: #241c22;   /* plum-charcoal */
  --muted: #857a82;
  --plum: #5b2a4e;         /* deep primary */
  --rose: #c25e8b;         /* brand mid / CTA */
  --gold: #c9a24b;         /* accent */
  --border: #ebe2d9;
  --success: #2e7d5b;
  --warn: #b4791f;
  --error: #b3261e;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-plum: var(--plum);
  --color-rose: var(--rose);
  --color-gold: var(--gold);
  --color-border: var(--border);
  --color-success: var(--success);
  --color-warn: var(--warn);
  --color-error: var(--error);
  --font-sans: var(--font-bengali);
  --font-display: var(--font-display);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-bengali), system-ui, sans-serif;
}

/* Signature gradient, now demoted to an accent (rose -> plum). */
.brand-gradient {
  background-image: linear-gradient(120deg, var(--rose), var(--plum));
}
.brand-gradient-text {
  background-image: linear-gradient(120deg, var(--rose), var(--plum));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Add the display font in the layout**

In `frontend/src/app/layout.tsx`, replace the font import block. Change the import line to:
```tsx
import { Hind_Siliguri, Noto_Serif_Bengali } from "next/font/google";
```
Add below the existing `bengali` font declaration:
```tsx
// Elegant Bengali serif for headings (editorial feel). Kept light for 2G.
const display = Noto_Serif_Bengali({
  variable: "--font-display",
  subsets: ["bengali", "latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});
```
Then update the `<html>` className to include both variables:
```tsx
<html lang="bn" className={`${bengali.variable} ${display.variable} h-full antialiased`}>
```

- [ ] **Step 4: Verify it builds and renders**

Run: `npm run build`
Expected: build succeeds, no font or CSS errors.
Then run `npm run dev`, open `http://localhost:3000`, confirm the page background is cream and text is plum-charcoal (no crash). Existing pages still load.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/layout.tsx
git commit -m "feat: premium-editorial design tokens and fonts"
```

---

### Task 3: Button primitive

**Files:**
- Create: `frontend/src/components/ui/Button.tsx`
- Test: `frontend/src/components/ui/Button.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/cn`.
- Produces: `Button` — props extend `React.ButtonHTMLAttributes<HTMLButtonElement>` plus `variant?: "primary" | "secondary" | "ghost"` (default `"primary"`), `size?: "md" | "lg"` (default `"md"`), `fullWidth?: boolean`. Min height 48px (`lg` = 56px). Used by every CTA in later phases.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Button.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>কার্টে যোগ করুন</Button>);
    expect(screen.getByRole("button", { name: "কার্টে যোগ করুন" })).toBeInTheDocument();
  });
  it("calls onClick when pressed", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>ঠিক আছে</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>ঠিক আছে</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
  it("applies the secondary variant classes", () => {
    render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole("button").className).toContain("border");
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/Button.test.tsx`
Expected: FAIL — cannot find `./Button`.

- [ ] **Step 3: Implement the Button**

Create `frontend/src/components/ui/Button.tsx`:
```tsx
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-sm active:scale-[0.98]",
  secondary: "border border-plum/30 text-plum bg-surface active:scale-[0.98]",
  ghost: "text-plum bg-transparent active:bg-surface-2",
};

const SIZES: Record<Size, string> = {
  md: "min-h-12 px-5 text-sm",
  lg: "min-h-14 px-6 text-base",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold",
        "transition disabled:opacity-50 disabled:pointer-events-none",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/Button.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Button.tsx frontend/src/components/ui/Button.test.tsx
git commit -m "feat: Button primitive with variants"
```

---

### Task 4: Badge + PriceTag

Merchandising atoms. `Badge` shows status pills (new / discount / low-stock / out-of-stock / combo). `PriceTag` renders a price with optional strike-through compare-at and discount percent — **string in, no float math**.

**Files:**
- Create: `frontend/src/components/ui/Badge.tsx`
- Create: `frontend/src/components/ui/PriceTag.tsx`
- Test: `frontend/src/components/ui/Badge.test.tsx`
- Test: `frontend/src/components/ui/PriceTag.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces:
  - `Badge` — props `tone?: "gold" | "rose" | "success" | "warn" | "error" | "neutral"` (default `"neutral"`), children.
  - `PriceTag` — props `price: string`, `compareAt?: string | null`, `size?: "sm" | "md" | "lg"`. Renders `৳{price}`; if `compareAt` is a larger number, shows it struck through plus a `-N%` badge. Percent computed with integer rounding for **display only** (source of truth stays Decimal on the server).

- [ ] **Step 1: Write the failing Badge test**

Create `frontend/src/components/ui/Badge.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge tone="error">স্টক নেই</Badge>);
    expect(screen.getByText("স্টক নেই")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the failing PriceTag test**

Create `frontend/src/components/ui/PriceTag.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceTag } from "./PriceTag";

describe("PriceTag", () => {
  it("shows the price with a taka sign", () => {
    render(<PriceTag price="500.00" />);
    expect(screen.getByText("৳500")).toBeInTheDocument();
  });
  it("shows compare-at strike and discount percent when cheaper", () => {
    render(<PriceTag price="400" compareAt="500" />);
    expect(screen.getByText("৳500")).toBeInTheDocument();
    expect(screen.getByText("-20%")).toBeInTheDocument();
  });
  it("hides compare-at when it is not higher than price", () => {
    render(<PriceTag price="500" compareAt="500" />);
    expect(screen.queryByText("-0%")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run both and confirm failure**

Run: `npm test -- src/components/ui/Badge.test.tsx src/components/ui/PriceTag.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement Badge**

Create `frontend/src/components/ui/Badge.tsx`:
```tsx
import { cn } from "@/lib/cn";

type Tone = "gold" | "rose" | "success" | "warn" | "error" | "neutral";

const TONES: Record<Tone, string> = {
  gold: "bg-gold/15 text-gold",
  rose: "bg-rose/15 text-rose",
  success: "bg-success/15 text-success",
  warn: "bg-warn/15 text-warn",
  error: "bg-error/15 text-error",
  neutral: "bg-surface-2 text-muted",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Implement PriceTag**

Create `frontend/src/components/ui/PriceTag.tsx`:
```tsx
import { cn } from "@/lib/cn";
import { Badge } from "./Badge";

// Prices arrive as decimal strings. Trim a trailing ".00"/".x0" for display only.
function fmt(v: string): string {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return `৳${Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, "")}`;
}

const SIZES = { sm: "text-sm", md: "text-lg", lg: "text-2xl" } as const;

export function PriceTag({
  price,
  compareAt,
  size = "md",
  className,
}: {
  price: string;
  compareAt?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const p = Number(price);
  const c = compareAt ? Number(compareAt) : NaN;
  const discounted = !Number.isNaN(c) && c > p;
  const pct = discounted ? Math.round(((c - p) / c) * 100) : 0;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className={cn("font-display font-bold text-plum", SIZES[size])}>
        {fmt(price)}
      </span>
      {discounted && (
        <>
          <span className="text-sm text-muted line-through">{fmt(compareAt!)}</span>
          <Badge tone="rose">-{pct}%</Badge>
        </>
      )}
    </span>
  );
}
```

- [ ] **Step 6: Run both and confirm pass**

Run: `npm test -- src/components/ui/Badge.test.tsx src/components/ui/PriceTag.test.tsx`
Expected: PASS (1 + 3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/Badge.tsx frontend/src/components/ui/PriceTag.tsx frontend/src/components/ui/Badge.test.tsx frontend/src/components/ui/PriceTag.test.tsx
git commit -m "feat: Badge and PriceTag atoms"
```

---

### Task 5: RatingStars

**Files:**
- Create: `frontend/src/components/ui/RatingStars.tsx`
- Test: `frontend/src/components/ui/RatingStars.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `RatingStars` — props `value: number` (0–5, may be fractional), `count?: number` (review count shown as `(N)`), `size?: "sm" | "md"`. Read-only display used on product cards + detail. Accessible label `aria-label="{value} এর মধ্যে 5"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/RatingStars.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RatingStars } from "./RatingStars";

describe("RatingStars", () => {
  it("exposes an accessible label with the value", () => {
    render(<RatingStars value={4.5} />);
    expect(screen.getByLabelText("4.5 এর মধ্যে 5")).toBeInTheDocument();
  });
  it("shows the review count when provided", () => {
    render(<RatingStars value={4} count={12} />);
    expect(screen.getByText("(12)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/RatingStars.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement RatingStars**

Create `frontend/src/components/ui/RatingStars.tsx`:
```tsx
import { cn } from "@/lib/cn";

export function RatingStars({
  value,
  count,
  size = "sm",
}: {
  value: number;
  count?: number;
  size?: "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const text = size === "md" ? "text-lg" : "text-sm";
  return (
    <span
      className="inline-flex items-center gap-1"
      aria-label={`${value} এর মধ্যে 5`}
    >
      <span className={cn("relative inline-block leading-none", text)}>
        <span className="text-border">★★★★★</span>
        <span
          className="absolute inset-0 overflow-hidden text-gold"
          style={{ width: `${pct}%` }}
          aria-hidden
        >
          ★★★★★
        </span>
      </span>
      {typeof count === "number" && (
        <span className="text-xs text-muted">({count})</span>
      )}
    </span>
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/RatingStars.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/RatingStars.tsx frontend/src/components/ui/RatingStars.test.tsx
git commit -m "feat: RatingStars display component"
```

---

### Task 6: QuantityStepper

**Files:**
- Create: `frontend/src/components/ui/QuantityStepper.tsx`
- Test: `frontend/src/components/ui/QuantityStepper.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `QuantityStepper` — controlled: props `value: number`, `onChange: (next: number) => void`, `min?: number` (default 1), `max?: number` (default 99). Two 48px buttons + a readout. Clamps to `[min, max]`. Used in cart + product detail later.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/QuantityStepper.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuantityStepper } from "./QuantityStepper";

describe("QuantityStepper", () => {
  it("increments and decrements within bounds", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={2} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText("বাড়ান"));
    expect(onChange).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByLabelText("কমান"));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
  it("does not go below min", async () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={1} onChange={onChange} min={1} />);
    await userEvent.click(screen.getByLabelText("কমান"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/QuantityStepper.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement QuantityStepper**

Create `frontend/src/components/ui/QuantityStepper.tsx`:
```tsx
"use client";
import { cn } from "@/lib/cn";

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const set = (n: number) => {
    if (n < min || n > max) return;
    onChange(n);
  };
  const btn =
    "flex h-12 w-12 items-center justify-center text-xl text-plum disabled:opacity-40";
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-surface",
        className,
      )}
    >
      <button
        type="button"
        aria-label="কমান"
        className={btn}
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        −
      </button>
      <span className="w-8 text-center font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="বাড়ান"
        className={btn}
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/QuantityStepper.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/QuantityStepper.tsx frontend/src/components/ui/QuantityStepper.test.tsx
git commit -m "feat: QuantityStepper component"
```

---

### Task 7: Layout primitives (Container, Section, StickyActionBar)

Structural wrappers so pages share consistent width, spacing, and the mobile sticky action pattern (used for add-to-cart / live price / wizard next).

**Files:**
- Create: `frontend/src/components/ui/Container.tsx`
- Create: `frontend/src/components/ui/Section.tsx`
- Create: `frontend/src/components/ui/StickyActionBar.tsx`
- Test: `frontend/src/components/ui/layout.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces:
  - `Container` — centers content, `max-w-screen-sm` on mobile up to `max-w-6xl` on desktop, horizontal padding. Props: `className`, `children`.
  - `Section` — vertical rhythm wrapper with optional `title` (rendered as `font-display` heading) and `action` (right-aligned node, e.g. "সব দেখুন" link). Props: `title?`, `action?`, `className`, `children`.
  - `StickyActionBar` — fixed bottom bar (safe-area aware) holding a live price / primary CTA on mobile. Props: `className`, `children`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/layout.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Container } from "./Container";
import { Section } from "./Section";
import { StickyActionBar } from "./StickyActionBar";

describe("layout primitives", () => {
  it("Container renders children", () => {
    render(<Container>ভেতরে</Container>);
    expect(screen.getByText("ভেতরে")).toBeInTheDocument();
  });
  it("Section renders a title and its children", () => {
    render(<Section title="জনপ্রিয়">কার্ড</Section>);
    expect(screen.getByRole("heading", { name: "জনপ্রিয়" })).toBeInTheDocument();
    expect(screen.getByText("কার্ড")).toBeInTheDocument();
  });
  it("StickyActionBar renders children", () => {
    render(<StickyActionBar>বার</StickyActionBar>);
    expect(screen.getByText("বার")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/layout.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement Container**

Create `frontend/src/components/ui/Container.tsx`:
```tsx
import { cn } from "@/lib/cn";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Implement Section**

Create `frontend/src/components/ui/Section.tsx`:
```tsx
import { cn } from "@/lib/cn";

export function Section({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("py-6", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && (
            <h2 className="font-display text-xl font-bold text-plum">{title}</h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 5: Implement StickyActionBar**

Create `frontend/src/components/ui/StickyActionBar.tsx`:
```tsx
import { cn } from "@/lib/cn";

export function StickyActionBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur",
        "px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Run it and confirm pass**

Run: `npm test -- src/components/ui/layout.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui/Container.tsx frontend/src/components/ui/Section.tsx frontend/src/components/ui/StickyActionBar.tsx frontend/src/components/ui/layout.test.tsx
git commit -m "feat: Container, Section, StickyActionBar layout primitives"
```

---

### Task 8: Skeleton + EmptyState

Low-bandwidth affordances: shimmer placeholders for lazy images, and a friendly empty/no-result panel.

**Files:**
- Create: `frontend/src/components/ui/Skeleton.tsx`
- Create: `frontend/src/components/ui/EmptyState.tsx`
- Test: `frontend/src/components/ui/EmptyState.test.tsx`

**Interfaces:**
- Consumes: `cn`, `Button`.
- Produces:
  - `Skeleton` — props `className` (caller sets size). A muted animated block.
  - `EmptyState` — props `icon?: React.ReactNode`, `title: string`, `hint?: string`, `action?: { label: string; onClick: () => void }`. Used for empty cart, no search results, empty wishlist.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/EmptyState.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and hint", () => {
    render(<EmptyState title="কিছু পাওয়া যায়নি" hint="আবার চেষ্টা করুন" />);
    expect(screen.getByText("কিছু পাওয়া যায়নি")).toBeInTheDocument();
    expect(screen.getByText("আবার চেষ্টা করুন")).toBeInTheDocument();
  });
  it("fires the action", async () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="খালি" action={{ label: "শপে যান", onClick }} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "শপে যান" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/EmptyState.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Skeleton**

Create `frontend/src/components/ui/Skeleton.tsx`:
```tsx
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-surface-2", className)}
      aria-hidden
    />
  );
}
```

- [ ] **Step 4: Implement EmptyState**

Create `frontend/src/components/ui/EmptyState.tsx`:
```tsx
import { Button } from "./Button";

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-4xl">{icon}</div>}
      <p className="font-display text-lg font-bold text-plum">{title}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {action && (
        <Button className="mt-2" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run it and confirm pass**

Run: `npm test -- src/components/ui/EmptyState.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/Skeleton.tsx frontend/src/components/ui/EmptyState.tsx frontend/src/components/ui/EmptyState.test.tsx
git commit -m "feat: Skeleton and EmptyState components"
```

---

### Task 9: Drawer (bottom-sheet / side panel)

The progressive-disclosure surface for filters, the category menu, and sort. Mobile = bottom sheet; closes on backdrop click and Escape; locks body scroll while open.

**Files:**
- Create: `frontend/src/components/ui/Drawer.tsx`
- Test: `frontend/src/components/ui/Drawer.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Drawer` — props `open: boolean`, `onClose: () => void`, `title?: string`, `side?: "bottom" | "right"` (default `"bottom"`), `children`. Renders nothing when closed. Backdrop + panel; Escape and backdrop click call `onClose`. Used by FilterDrawer, SortMenu, and the header category menu in later phases.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Drawer.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}}>
        ভেতরে
      </Drawer>,
    );
    expect(screen.queryByText("ভেতরে")).not.toBeInTheDocument();
  });
  it("shows content and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="ফিল্টার">
        ভেতরে
      </Drawer>,
    );
    expect(screen.getByText("ভেতরে")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("closes on backdrop click", async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        ভেতরে
      </Drawer>,
    );
    await userEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/Drawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Drawer**

Create `frontend/src/components/ui/Drawer.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { cn } from "@/lib/cn";

export function Drawer({
  open,
  onClose,
  title,
  side = "bottom",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: "bottom" | "right";
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const panel =
    side === "bottom"
      ? "inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl"
      : "inset-y-0 right-0 w-[85vw] max-w-sm";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div
        data-testid="drawer-backdrop"
        className="absolute inset-0 bg-foreground/40"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute overflow-y-auto bg-surface p-4 shadow-xl",
          panel,
        )}
      >
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-plum">{title}</h3>
            <button
              type="button"
              aria-label="বন্ধ করুন"
              className="flex h-10 w-10 items-center justify-center text-2xl text-muted"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/Drawer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Drawer.tsx frontend/src/components/ui/Drawer.test.tsx
git commit -m "feat: Drawer bottom-sheet / side panel"
```

---

### Task 10: Toast (provider + hook)

App-wide feedback ("কার্টে যোগ হয়েছে", "কুপন কাজ করেনি"). Provider mounts once; `useToast()` pushes messages that auto-dismiss.

**Files:**
- Create: `frontend/src/components/ui/Toast.tsx`
- Test: `frontend/src/components/ui/Toast.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces:
  - `ToastProvider` — wraps the app (mounted in `layout.tsx` in Task 12).
  - `useToast(): { toast: (msg: string, tone?: "success" | "error") => void }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/Toast.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./Toast";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("সংরক্ষিত হয়েছে")}>দেখাও</button>;
}

describe("Toast", () => {
  it("shows a message after the hook is called", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "দেখাও" }));
    expect(await screen.findByText("সংরক্ষিত হয়েছে")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/Toast.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Toast**

Create `frontend/src/components/ui/Toast.tsx`:
```tsx
"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "error";
interface Item {
  id: number;
  msg: string;
  tone: Tone;
}
interface Ctx {
  toast: (msg: string, tone?: Tone) => void;
}

const ToastContext = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const toast = useCallback((msg: string, tone: Tone = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, msg, tone }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div
            key={i.id}
            role="status"
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg",
              i.tone === "error" ? "bg-error" : "bg-success",
            )}
          >
            {i.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/Toast.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/Toast.tsx frontend/src/components/ui/Toast.test.tsx
git commit -m "feat: Toast provider and useToast hook"
```

---

### Task 11: SearchBar

The primary discovery entry. Controlled input with a submit that navigates to `/shop?q=...`. Kept simple (no live suggestions in Phase 0).

**Files:**
- Create: `frontend/src/components/ui/SearchBar.tsx`
- Test: `frontend/src/components/ui/SearchBar.test.tsx`

**Interfaces:**
- Consumes: `cn`.
- Produces: `SearchBar` — props `defaultValue?: string`, `onSubmit: (q: string) => void`, `placeholder?: string` (default `"খুঁজুন..."`). Submits on Enter or the search button; trims input. The header wires `onSubmit` to router navigation in Task 12.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ui/SearchBar.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  it("submits the trimmed query", async () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    await userEvent.type(screen.getByRole("searchbox"), "  বই  ");
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(onSubmit).toHaveBeenCalledWith("বই");
  });
  it("does not submit an empty query", async () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npm test -- src/components/ui/SearchBar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement SearchBar**

Create `frontend/src/components/ui/SearchBar.tsx`:
```tsx
"use client";
import { useState } from "react";
import { cn } from "@/lib/cn";

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
        role="searchbox"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        aria-label="খুঁজুন"
        className="text-lg text-plum"
      >
        🔍
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run it and confirm pass**

Run: `npm test -- src/components/ui/SearchBar.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/SearchBar.tsx frontend/src/components/ui/SearchBar.test.tsx
git commit -m "feat: SearchBar component"
```

---

### Task 12: Site shell — SiteHeader, SiteFooter, MobileTabBar — and layout wiring

Replace the thin `BrandHeader` usage with a real storefront shell: header (wordmark, search, category-menu button, cart, wishlist, account icons), a footer with trust/contact info, and a mobile bottom tab bar. Mount `ToastProvider` + shell in the root layout. Category menu opens a `Drawer` with a placeholder note (real category data lands in Phase 1).

**Files:**
- Create: `frontend/src/components/shell/SiteHeader.tsx`
- Create: `frontend/src/components/shell/SiteFooter.tsx`
- Create: `frontend/src/components/shell/MobileTabBar.tsx`
- Modify: `frontend/src/app/layout.tsx`
- Test: `frontend/src/components/shell/SiteHeader.test.tsx`

**Interfaces:**
- Consumes: `SearchBar`, `Drawer`, `Container`, `cn`, `next/link`, `next/navigation` (`useRouter`).
- Produces: `SiteHeader`, `SiteFooter`, `MobileTabBar` (all default-exported client components). Header links: `/` (logo), `/shop`, `/cart`, `/wishlist`, `/account`. Search submit → `router.push('/shop?q=' + encodeURIComponent(q))`.

- [ ] **Step 1: Read the Next 16 navigation guide**

Run: `ls frontend/node_modules/next/dist/docs/01-app/` and open the routing/`useRouter` (`next/navigation`) guide.
Expected: confirm `useRouter().push` and `Link` usage for Next 16.

- [ ] **Step 2: Write the failing header test**

Create `frontend/src/components/shell/SiteHeader.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SiteHeader from "./SiteHeader";

describe("SiteHeader", () => {
  it("shows the brand wordmark and cart link", () => {
    render(<SiteHeader />);
    expect(screen.getByText("Zaujain Nikah Point")).toBeInTheDocument();
    expect(screen.getByLabelText("কার্ট")).toBeInTheDocument();
  });
  it("navigates to shop with the search query", async () => {
    render(<SiteHeader />);
    await userEvent.type(screen.getByRole("searchbox"), "বই");
    await userEvent.click(screen.getByRole("button", { name: "খুঁজুন" }));
    expect(push).toHaveBeenCalledWith("/shop?q=%E0%A6%AC%E0%A6%87");
  });
});
```

- [ ] **Step 3: Run it and confirm failure**

Run: `npm test -- src/components/shell/SiteHeader.test.tsx`
Expected: FAIL — cannot find `./SiteHeader`.

- [ ] **Step 4: Implement SiteHeader**

Create `frontend/src/components/shell/SiteHeader.tsx`:
```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { Drawer } from "@/components/ui/Drawer";
import { SearchBar } from "@/components/ui/SearchBar";

export default function SiteHeader() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (q: string) => router.push(`/shop?q=${encodeURIComponent(q)}`);

  const iconLink = "flex h-11 w-11 items-center justify-center text-xl text-plum";

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <Container className="flex items-center gap-3 py-3">
        <button
          type="button"
          aria-label="মেনু"
          className={iconLink}
          onClick={() => setMenuOpen(true)}
        >
          ☰
        </button>
        <Link href="/" className="mr-auto leading-tight">
          <span className="brand-gradient-text font-display text-lg font-bold">
            Zaujain Nikah Point
          </span>
        </Link>
        <Link href="/wishlist" aria-label="উইশলিস্ট" className={iconLink}>
          ♡
        </Link>
        <Link href="/account" aria-label="অ্যাকাউন্ট" className={iconLink}>
          👤
        </Link>
        <Link href="/cart" aria-label="কার্ট" className={iconLink}>
          🛒
        </Link>
      </Container>
      <Container className="pb-3">
        <SearchBar onSubmit={go} />
      </Container>

      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="বিভাগসমূহ">
        <nav className="flex flex-col gap-1">
          <Link
            href="/shop"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            সব পণ্য
          </Link>
          <Link
            href="/customize"
            className="rounded-lg px-3 py-3 text-plum active:bg-surface-2"
            onClick={() => setMenuOpen(false)}
          >
            কাস্টমাইজ করুন
          </Link>
          <p className="px-3 pt-4 text-xs text-muted">
            বিভাগ শীঘ্রই যুক্ত হবে
          </p>
        </nav>
      </Drawer>
    </header>
  );
}
```

- [ ] **Step 5: Implement SiteFooter**

Create `frontend/src/components/shell/SiteFooter.tsx`:
```tsx
import Link from "next/link";
import { Container } from "@/components/ui/Container";

export default function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-border bg-surface-2">
      <Container className="grid gap-6 py-8 text-sm sm:grid-cols-3">
        <div>
          <p className="brand-gradient-text font-display text-lg font-bold">
            Zaujain Nikah Point
          </p>
          <p className="mt-1 text-muted">প্রিমিয়াম কাস্টমাইজড নিকাহনামা</p>
        </div>
        <nav className="flex flex-col gap-2 text-plum">
          <Link href="/shop">সব পণ্য</Link>
          <Link href="/customize">কাস্টমাইজ করুন</Link>
          <Link href="/track">অর্ডার ট্র্যাক করুন</Link>
        </nav>
        <div className="text-muted">
          <p>ক্যাশ অন ডেলিভারি</p>
          <p>সারা বাংলাদেশে ডেলিভারি</p>
        </div>
      </Container>
    </footer>
  );
}
```

- [ ] **Step 6: Implement MobileTabBar**

Create `frontend/src/components/shell/MobileTabBar.tsx`:
```tsx
import Link from "next/link";

const tabs = [
  { href: "/", label: "হোম", icon: "🏠" },
  { href: "/shop", label: "শপ", icon: "🛍️" },
  { href: "/customize", label: "কাস্টম", icon: "✨" },
  { href: "/cart", label: "কার্ট", icon: "🛒" },
];

export default function MobileTabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur sm:hidden">
      <ul className="mx-auto flex max-w-6xl items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <li key={t.href} className="flex-1">
            <Link
              href={t.href}
              className="flex flex-col items-center gap-0.5 py-2 text-xs text-plum"
            >
              <span className="text-lg">{t.icon}</span>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 7: Run the header test and confirm pass**

Run: `npm test -- src/components/shell/SiteHeader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 8: Wire the shell into the root layout**

In `frontend/src/app/layout.tsx`, import the shell + toast and wrap children. Replace the `<body>` block with:
```tsx
import SiteHeader from "@/components/shell/SiteHeader";
import SiteFooter from "@/components/shell/SiteFooter";
import MobileTabBar from "@/components/shell/MobileTabBar";
import { ToastProvider } from "@/components/ui/Toast";
```
```tsx
<body className="min-h-full flex flex-col bg-background text-foreground">
  <ToastProvider>
    <SiteHeader />
    <main className="flex-1 pb-20 sm:pb-0">{children}</main>
    <SiteFooter />
    <MobileTabBar />
    <ChatWidget />
  </ToastProvider>
</body>
```
(Keep the existing `ChatWidget` import.)

- [ ] **Step 9: Verify the app renders with the new shell**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: new header (menu, wordmark, wishlist/account/cart icons, search bar), footer, and mobile tab bar visible; menu button opens the category drawer; searching navigates to `/shop?q=...`. No console errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/shell/ frontend/src/app/layout.tsx
git commit -m "feat: premium site shell (header, footer, mobile tab bar) + toast provider"
```

---

### Task 13: Re-skin ChatWidget to new tokens

The floating chat pill still uses old brand colors implicitly. Repoint its styles to the new tokens/utilities without touching its behavior (polling, dedupe, quick replies).

**Files:**
- Modify: `frontend/src/components/ChatWidget.tsx` (class names only)

**Interfaces:**
- Consumes: existing chat API (`chatSend`, `chatPoll`) — unchanged.
- Produces: no interface change; visual only.

- [ ] **Step 1: Read the current widget**

Read `frontend/src/components/ChatWidget.tsx` in full. Identify every hardcoded color / old-brand class (e.g. `brand-gradient`, `bg-brand-*`, purple/pink literals).

- [ ] **Step 2: Repoint colors to new tokens**

Replace old-brand classes with new ones: keep `brand-gradient` (already re-pointed in Task 2) for the launcher/CTA; swap any `bg-brand-purple`/`bg-brand-pink`/`text-brand-*` or hex literals for `bg-plum` / `text-plum` / `bg-surface` / `border-border` / `text-muted` as appropriate. Do not change any logic, state, effect, or API call.

- [ ] **Step 3: Verify behavior unchanged**

Run: `npm run dev`, open the storefront, open the chat pill, send a message.
Expected: widget matches the new palette; sending + polling + quick replies still work exactly as before.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatWidget.tsx
git commit -m "style: re-skin ChatWidget to premium tokens"
```

---

### Task 14: `/ui-kit` preview page (dev reference)

A single page that renders every component in its states, so the design system can be eyeballed and future phases have a living reference. Not linked from the storefront.

**Files:**
- Create: `frontend/src/app/ui-kit/page.tsx`

**Interfaces:**
- Consumes: all `components/ui/*`.
- Produces: a route at `/ui-kit`. No test (visual reference only).

- [ ] **Step 1: Create the preview page**

Create `frontend/src/app/ui-kit/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PriceTag } from "@/components/ui/PriceTag";
import { RatingStars } from "@/components/ui/RatingStars";
import { QuantityStepper } from "@/components/ui/QuantityStepper";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Drawer } from "@/components/ui/Drawer";
import { SearchBar } from "@/components/ui/SearchBar";
import { useToast } from "@/components/ui/Toast";

export default function UiKit() {
  const [qty, setQty] = useState(1);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  return (
    <Container>
      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>প্রাইমারি</Button>
          <Button variant="secondary">সেকেন্ডারি</Button>
          <Button variant="ghost">ঘোস্ট</Button>
          <Button disabled>নিষ্ক্রিয়</Button>
        </div>
      </Section>
      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge tone="gold">নতুন</Badge>
          <Badge tone="rose">-20%</Badge>
          <Badge tone="warn">শেষ হয়ে যাচ্ছে</Badge>
          <Badge tone="error">স্টক নেই</Badge>
        </div>
      </Section>
      <Section title="Price + Rating">
        <div className="flex flex-col gap-3">
          <PriceTag price="400" compareAt="500" size="lg" />
          <RatingStars value={4.5} count={23} size="md" />
        </div>
      </Section>
      <Section title="Quantity / Search">
        <div className="flex flex-col gap-4">
          <QuantityStepper value={qty} onChange={setQty} />
          <SearchBar onSubmit={(q) => toast(`খুঁজছি: ${q}`)} />
        </div>
      </Section>
      <Section title="Skeleton / Empty">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="aspect-square" />
          <EmptyState title="কিছু নেই" hint="পরে দেখুন" />
        </div>
      </Section>
      <Section title="Overlays">
        <div className="flex gap-3">
          <Button onClick={() => setOpen(true)}>ড্রয়ার খুলুন</Button>
          <Button variant="secondary" onClick={() => toast("সংরক্ষিত হয়েছে")}>
            টোস্ট
          </Button>
        </div>
        <Drawer open={open} onClose={() => setOpen(false)} title="ফিল্টার">
          <p className="text-muted">ড্রয়ারের ভেতরের কনটেন্ট।</p>
        </Drawer>
      </Section>
    </Container>
  );
}
```

- [ ] **Step 2: Verify the kit renders**

Run: `npm run dev`, open `http://localhost:3000/ui-kit`.
Expected: every component renders correctly in the premium palette; drawer opens, toast fires, stepper and search work.

- [ ] **Step 3: Full build + test gate**

Run: `npm run build && npm test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/ui-kit/page.tsx
git commit -m "chore: add /ui-kit component preview page"
```

---

## Self-Review

**Spec coverage (Phase 0 scope = design tokens, fonts, component library, new shell, chatbot re-skin):**
- Tokens + fonts → Task 2. ✅
- Component library (Button, Badge, PriceTag, RatingStars, QuantityStepper, Container, Section, StickyActionBar, Skeleton, EmptyState, Drawer, Toast, SearchBar) → Tasks 3–11. ✅ (WishlistHeart deferred to Phase 3 where wishlist state exists — noted; not needed for Phase 0.)
- New header/footer/shell → Task 12. ✅
- Chatbot widget re-skin → Task 13. ✅
- Test tooling (enabling TDD for all later phases) → Task 1. ✅
- Living reference → Task 14. ✅

**Placeholder scan:** No "TBD"/"handle appropriately"/uncoded steps — every code step shows full code. The header category drawer intentionally shows a "বিভাগ শীঘ্রই যুক্ত হবে" note because category data is a Phase 1 deliverable; this is explicit, not a placeholder. ✅

**Type consistency:** `cn` signature identical across all consumers. `Button` variant names (`primary|secondary|ghost`) reused in `/ui-kit`. `useToast()` returns `{ toast }` and is called as such in header/ui-kit. `Drawer` props (`open/onClose/title/side`) match usages. `SearchBar.onSubmit(q)` matches header `go`. ✅

**Notes for later phases:** `WishlistHeart`, `FilterDrawer`, `SortMenu`, `ProductCard`, `CategoryTile`, `CollectionCard`, `Breadcrumbs`, `Pagination`, `Modal` are built in the phases that first need them (they depend on data/state that doesn't exist yet). `StickyActionBar` is created here but first consumed in Phase 1/2 product + cart pages.
