// Admin panel API client. Token auth stored in localStorage. English UI.

import { API_BASE } from "./api";

const TOKEN_KEY = "zaujain_admin_token";

// Generous, because the backend runs on shared cPanel/Passenger: the first
// request after an idle period pays for the app booting. Long enough to survive
// a cold start, short enough that a dead request says so instead of hanging.
const REQUEST_TIMEOUT_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 180_000;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function req<T>(
  path: string,
  method = "GET",
  body?: unknown,
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Token ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  // Admin data must always be fresh — without this the browser serves cached GETs
  // and newly created rows only appear after several manual refreshes.
  //
  // The timeout is the difference between "this is slow" and "the panel is
  // broken": with none, a request the server never answers leaves the page on
  // its spinner indefinitely, with nothing on screen saying so. Uploads get
  // longer — a photo over a Bangladeshi mobile line is legitimately slow.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/admin/${path}`, {
      method, headers, body: payload, cache: "no-store",
      signal: AbortSignal.timeout(isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("The server did not answer in time. It may be waking up — try again.");
    }
    throw new Error("Could not reach the server. Check the connection and try again.");
  }
  if (res.status === 401) {
    clearToken();
    // Never bounce the login page to itself — that is a full reload, and the
    // page refires the request on mount, so it loops and no one can type.
    if (typeof window !== "undefined" && window.location.pathname !== "/admin/login") {
      window.location.href = "/admin/login";
    }
    throw new Error("Session expired");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Request failed");
  return data as T;
}

export const adminGet = <T>(p: string) => req<T>(p);
export const adminPost = <T>(p: string, body?: unknown) => req<T>(p, "POST", body);
export const adminPatch = <T>(p: string, body?: unknown) => req<T>(p, "PATCH", body);
export const adminPut = <T>(p: string, body?: unknown) => req<T>(p, "PUT", body);
export const adminDelete = <T>(p: string) => req<T>(p, "DELETE");
export const adminForm = <T>(p: string, form: FormData, method = "POST") =>
  req<T>(p, method, form, true);

// ---- auth ----
export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/api/admin/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Login failed");
  setToken(data.token);
  return data as { token: string; username: string };
}

// ---- types ----
export interface AnalyticsData {
  daily: { date: string; orders: number; revenue: number }[];
  status_breakdown: { status: string; count: number }[];
}

// ---- Storefront analytics (self-hosted) ----

export interface LiveData {
  active: number;
  window_seconds: number;
  by_path: { path: string; count: number }[];
  by_device: { device: string; count: number }[];
  in_cart: number;
  in_checkout: number;
  in_wizard: number;
  recent: { name: string; path: string; ts: string; label: string }[];
}

export interface AnalyticsOverview {
  days: number;
  today: {
    date: string; sessions: number; visitors: number; new_visitors: number;
    pageviews: number; bounced_sessions: number; converted_sessions: number;
    bounce_rate: number; avg_seconds: number;
  };
  live: Omit<LiveData, "recent">;
  trend: { date: string; visitors: number; sessions: number; pageviews: number }[];
  top_pages: {
    path: string; views: number; sessions: number; entries: number; exits: number;
    /** Listing / gallery-tag name for catalogue paths — the slug alone is opaque. */
    label?: string;
  }[];
  top_combos: {
    combo_id: number; name: string; views: number; carts: number;
    orders: number; revenue: number; conversion: number;
  }[];
  sources: { source: string; sessions: number; orders: number }[];
  funnel: { step: string; sessions: number }[];
  empty_searches: { term: string; count: number }[];
  devices: { device: string; sessions: number }[];
}

export const getLive = () => adminGet<LiveData>("analytics/live/");
export const getOverview = (days: number) =>
  adminGet<AnalyticsOverview>(`analytics/overview/?days=${days}`);

export interface DashboardData {
  orders_today: number;
  pending_payment: number;
  pending_custom: number;
  total_orders: number;
  // Money is business-wide now (Finance cash-book), not per order.
  month_income: number;
  month_expense: number;
  month_net: number;
  dues_total: number;
  recent_orders: AdminOrder[];
  visitors_today: number;
  popups_shown_today: number;
  popups_clicked_today: number;
}

export interface ConfigLine {
  label: string;
  value: string;
  image: string | null;
}

// Customer-submitted TEXT inside an item's config, editable via
// `orders/{id}/edit_config/` — see ItemConfigField below. Loose elsewhere
// (color/design selections etc.) since those aren't edited from the admin.
export interface ItemConfigField {
  label: string;
  value: string;
}
export interface ItemConfigComboLine {
  label: string;
  value: string;
}
export interface ItemConfigComboItem {
  product: string;
  lines: ItemConfigComboLine[];
}
export interface ItemConfig {
  fields?: ItemConfigField[];
  note?: string;
  combo_items?: ItemConfigComboItem[];
  [key: string]: unknown;
}

export interface AdminOrderItem {
  id: number;
  product: number | null;
  combo: number | null;
  product_name: string;
  category: string;
  price_snapshot: string;
  is_custom_request: boolean;
  preview_image: string | null;
  config: ItemConfig;
  config_display: ConfigLine[];
  /** Listing lines only: what is actually in the box. Null for a plain product. */
  contents: { description: string; products: string[] } | null;
}

/**
 * An admin-only marking on an order — "urgent", "gift wrap", "call before
 * delivery". A row rather than text on the order, so renaming one renames it
 * everywhere and searching it finds exactly the orders carrying it.
 */
export type TagColour = "slate" | "red" | "amber" | "emerald" | "blue" | "violet" | "plum";

export interface OrderTag {
  id: number;
  name: string;
  colour: TagColour;
  order_count?: number;
}

export const TAG_COLOURS: TagColour[] =
  ["slate", "red", "amber", "emerald", "blue", "violet", "plum"];

/** Tailwind classes per swatch, written out because the class names must be
    literal for the compiler to see them — a template string would be purged. */
export const TAG_CLASSES: Record<TagColour, string> = {
  slate: "bg-slate-100 text-slate-700 border-slate-200",
  red: "bg-red-100 text-red-700 border-red-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
  blue: "bg-blue-100 text-blue-700 border-blue-200",
  violet: "bg-violet-100 text-violet-700 border-violet-200",
  plum: "bg-plum/10 text-plum border-plum/20",
};

export const listOrderTags = () => adminGet<OrderTag[]>("order-tags/");
export const createOrderTag = (body: { name: string; colour?: TagColour }) =>
  adminPost<OrderTag>("order-tags/", body);
export const updateOrderTag = (id: number, body: { name?: string; colour?: TagColour }) =>
  adminPatch<OrderTag>(`order-tags/${id}/`, body);
export const deleteOrderTag = (id: number) => adminDelete(`order-tags/${id}/`);

/** Replace an order's tags. `names` creates anything that does not exist yet. */
export const setOrderTags = (orderId: number, body: { tags?: number[]; names?: string[] }) =>
  adminPost<AdminOrder>(`orders/${orderId}/set_tags/`, body);

/** One line as the item editor sends it. Omit a key to leave that part alone. */
export interface OrderItemEdit {
  /** Existing line — it keeps its options, photo and history. Omit to add a new one. */
  id?: number;
  product?: number | null;
  combo?: number | null;
  title?: string;
  /** This order's price for the line. The catalogue is never touched. */
  price?: string;
  note?: string;
  fields?: ItemConfigField[];
}

/** Replace an order's lines: swap items, retype details, reprice for this order. */
export const editOrderItems = (orderId: number, items: OrderItemEdit[]) =>
  adminPost<AdminOrder>(`orders/${orderId}/edit_items/`, { items });

/**
 * One push from Steadfast's webhook. `delivery_status` carries a status;
 * `tracking_update` is the hub-by-hub narration their API cannot be polled for —
 * it exists only because they pushed it.
 */
export type ConsignmentEvent = {
  id: number;
  notification_type: "delivery_status" | "tracking_update" | string;
  status: string;
  tracking_message: string;
  /** Steadfast's own timestamp string, kept verbatim (no timezone documented). */
  event_time: string;
  received_at: string;
};

export type ExtraConsignment = {
  id: number;
  invoice: string;
  consignment_id: string;
  tracking_code: string;
  status: string;
  cod_amount: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  item_description: string;
  created_at: string;
  events: ConsignmentEvent[];
};

export interface AdminOrder {
  id: number;
  uid: string;
  customer_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  division: string;
  district: string;
  thana: string;
  address: string;
  full_address: string;
  is_repeat_customer: boolean;
  subtotal: string;
  delivery_charge: string;
  total: string;
  advance_required: boolean;
  advance_amount: string;
  advance_received: string;
  cod_amount: string;
  payment_method: string;
  transaction_id: string;
  payment_screenshot: string | null;
  payment_verified: boolean;
  fraud_check_result: Record<string, unknown>;
  steadfast_consignment_id: string;
  steadfast_tracking_code: string;
  steadfast_status: string;
  courier_submitted: boolean;
  status: string;
  status_display: string;
  created_at: string;
  tags: OrderTag[];
  items: AdminOrderItem[];
  extra_consignments: ExtraConsignment[];
  /** Primary parcel's timeline; each extra carries its own under itself. */
  consignment_events: ConsignmentEvent[];
}

/**
 * What the Orders LIST returns — scalars plus tags, no items.
 *
 * The full order is fetched when one is opened. Kept as its own type so the
 * table cannot start reading a field the list does not send: that field would
 * be `undefined` at runtime while looking perfectly typed.
 */
export interface AdminOrderRow {
  id: number;
  uid: string;
  customer_name: string;
  phone: string;
  district: string;
  subtotal: string;
  delivery_charge: string;
  total: string;
  advance_received: string;
  cod_amount: string;
  payment_verified: boolean;
  courier_submitted: boolean;
  is_repeat_customer: boolean;
  steadfast_status: string;
  status: string;
  status_display: string;
  created_at: string;
  tags: OrderTag[];
}

/**
 * One pickable thing for the manual-order item picker. `fields` are the detail
 * labels the storefront would ask for (বরের নাম, তারিখ…) — prefilled empty so the
 * owner can paste in what the customer sent on WhatsApp.
 */
export interface CatalogueEntry {
  id: number;
  name: string;
  category: string;
  price: string;
  image: string | null;
  fields: string[];
  /** Products only. */
  kind?: ProductKind;
  customizable?: boolean;
}

export interface OrderCatalogue {
  /** Buyable listings (PrebuiltCombo) — what the storefront actually sells. */
  listings: CatalogueEntry[];
  /** Customizer building blocks; sold directly only over chat. */
  products: CatalogueEntry[];
}

export const getOrderCatalogue = () => adminGet<OrderCatalogue>("orders/catalogue/");

export interface AdminCustomRequest {
  id: number;
  customer_name: string;
  phone: string;
  description: string;
  status: string;
  admin_final_price: string | null;
  created_at: string;
  reference_images: string[];
}

export type ProductKind = "layered" | "gallery" | "dupatta" | "simple";

export const PRODUCT_KINDS: { value: ProductKind; label: string }[] = [
  { value: "simple", label: "Simple (buy / pick one design)" },
  { value: "gallery", label: "Gallery (pick one design)" },
  { value: "layered", label: "Layered (color + corner + center)" },
  { value: "dupatta", label: "Dupatta (lace + lines)" },
];

export const PREVIEW_RATIOS = [
  { value: "1 / 1", label: "Square" },
  { value: "9 / 12", label: "Book (tall 9:12)" },
  { value: "12 / 10", label: "Box (wide 12:10)" },
];

export interface AdminProductImage {
  id: number;
  product: number;
  image: string;
  alt: string;
  order: number;
  is_primary: boolean;
}

export interface AdminProduct {
  id: number;
  name: string;
  slug: string;
  kind: ProductKind;
  category: string;
  base_price: string;
  preview_ratio: string;
  exclusive_group: string;
  customize_order: number;
  allows_individual_purchase: boolean;
  active: boolean;
  // E-commerce catalog fields
  description: string;
  compare_at_price: string | null;
  stock: number;
  track_stock: boolean;
  low_stock_threshold: number;
  is_featured: boolean;
  is_popular: boolean;
  home_order: number;
  images: AdminProductImage[];
  image_count: number;
}

// ---- product catalog images ----
export const listProductImages = (productId: number) =>
  adminGet<AdminProductImage[]>(`product-images/?product=${productId}`);

export function uploadProductImage(
  productId: number,
  file: File,
  opts?: { alt?: string; is_primary?: boolean; order?: number },
) {
  const fd = new FormData();
  fd.append("product", String(productId));
  fd.append("image", file);
  if (opts?.alt) fd.append("alt", opts.alt);
  if (opts?.is_primary != null) fd.append("is_primary", String(opts.is_primary));
  if (opts?.order != null) fd.append("order", String(opts.order));
  return adminForm<AdminProductImage>("product-images/", fd);
}

export const deleteProductImage = (id: number) => adminDelete(`product-images/${id}/`);

// ---- homepage: site settings (hero/band) ----
export interface SiteSettings {
  hero_image: string | null;
  hero_title: string;
  hero_subtitle: string;
  band_image: string | null;
}

export const getSiteSettings = () => adminGet<SiteSettings>("site-settings/");
export const updateSiteSettings = (form: FormData) =>
  adminForm<SiteSettings>("site-settings/", form, "PATCH");

// ---- homepage: category tiles ----
export interface HomeCategory {
  id: number;
  title: string;
  image: string | null;
  link: string;
  order: number;
  active: boolean;
}

export const listHomeCategories = () => adminGet<HomeCategory[]>("home-categories/");
export const createHomeCategory = (form: FormData) =>
  adminForm<HomeCategory>("home-categories/", form, "POST");
export const updateHomeCategory = (id: number, form: FormData) =>
  adminForm<HomeCategory>(`home-categories/${id}/`, form, "PATCH");
export const deleteHomeCategory = (id: number) => adminDelete(`home-categories/${id}/`);

export interface AdminComboImage {
  id: number;
  combo: number;
  image: string;
  order: number;
}

export interface AdminCombo {
  id: number;
  name: string;
  slug: string;
  /** Free-text label — card badge + /products filter. */
  category: string;
  description: string;
  price: string;
  products: number[];
  /** Pictured design per product id — seeds the wizard, snapshots onto orders. */
  preset_config: Record<string, Record<string, unknown>>;
  featured: boolean;
  active: boolean;
  images: AdminComboImage[];
}

// ---- combos (PrebuiltCombo) ----
export const listCombos = () => adminGet<AdminCombo[]>("combos/");
export const createCombo = (body: Partial<AdminCombo>) => adminPost<AdminCombo>("combos/", body);
export const updateCombo = (id: number, body: Partial<AdminCombo>) =>
  adminPatch<AdminCombo>(`combos/${id}/`, body);
export const deleteCombo = (id: number) => adminDelete(`combos/${id}/`);
export function uploadComboImage(comboId: number, file: File, order = 0) {
  const fd = new FormData();
  fd.append("combo", String(comboId));
  fd.append("image", file);
  fd.append("order", String(order));
  return adminForm<AdminComboImage>("combo-images/", fd);
}
export const deleteComboImage = (id: number) => adminDelete(`combo-images/${id}/`);

// ---- combo customer-input fields ----
export interface AdminComboField {
  id: number;
  combo: number;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}
export const adminComboFields = {
  list: (comboId: number) => adminGet<AdminComboField[]>(`combo-fields/?combo=${comboId}`),
  create: (body: Partial<AdminComboField>) => adminPost<AdminComboField>("combo-fields/", body),
  update: (id: number, body: Partial<AdminComboField>) =>
    adminPatch<AdminComboField>(`combo-fields/${id}/`, body),
  remove: (id: number) => adminDelete(`combo-fields/${id}/`),
};

export interface AdminChatSession {
  id: number;
  customer_name: string;
  phone: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message: string;
  unread: number;
}
export interface AdminChatMessage {
  id: number;
  role: "customer" | "bot" | "admin" | "system";
  text: string;
  image: string;
  album_url: string;
  upload: string;
  created_at: string;
}
// ---- Product customer-input fields ----
export interface AdminProductField {
  id: number;
  product: number;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}

export const adminProductFields = {
  list: (productId: number) =>
    adminGet<AdminProductField[]>(`product-fields/?product=${productId}`),
  create: (body: Partial<AdminProductField>) =>
    adminPost<AdminProductField>("product-fields/", body),
  update: (id: number, body: Partial<AdminProductField>) =>
    adminPatch<AdminProductField>(`product-fields/${id}/`, body),
  remove: (id: number) => adminDelete(`product-fields/${id}/`),
};

// ---- Customization option lists ----
// Same endpoints the per-product OptionManager (Products/Customization admin)
// already uses — reused here so the order-item option editor never duplicates
// the pricing/validation logic, only the read side (?product= filter).
export interface AdminColorOption {
  id: number;
  product: number;
  name: string;
  base_image: string;
  price_modifier: string;
  active: boolean;
}
export interface AdminToppingOption {
  id: number;
  product: number;
  placement: "corner" | "center";
  image: string;
  pos_x: number;
  pos_y: number;
  scale: number;
  price_modifier: string;
  active: boolean;
}
export interface AdminInsideOption {
  id: number;
  product: number;
  preview_image: string;
  price_modifier: string;
  active: boolean;
}
export interface AdminStaticOption {
  id: number;
  product: number;
  image: string;
  price_modifier: string;
  active: boolean;
}
export interface AdminDupattaOption {
  id: number;
  product: number;
  lace_type: string;
  text_lines: number;
  preview_image: string;
  price: string;
  active: boolean;
}

export const listColorOptions = (productId: number) =>
  adminGet<AdminColorOption[]>(`colors/?product=${productId}`);
export const listToppingOptions = (productId: number) =>
  adminGet<AdminToppingOption[]>(`toppings/?product=${productId}`);
export const listInsideOptions = (productId: number) =>
  adminGet<AdminInsideOption[]>(`inside/?product=${productId}`);
export const listStaticOptions = (productId: number) =>
  adminGet<AdminStaticOption[]>(`static/?product=${productId}`);
export const listDupattaOptions = (productId: number) =>
  adminGet<AdminDupattaOption[]>(`dupatta/?product=${productId}`);

// ---- Gallery ----
export interface AdminGalleryPhoto {
  id: number;
  image: string;
  display: string;
  thumbnail: string;
  caption: string;
  alt: string;
  order: number;
  tag_count: number;
}
export interface AdminGalleryTag {
  id: number;
  title: string;
  slug: string;
  description: string;
  cover: number | null;
  order: number;
  active: boolean;
  is_bot_default: boolean;
  photo_ids: number[];
  count: number;
}

export const adminGallery = {
  photos: () => adminGet<AdminGalleryPhoto[]>("gallery-photos/"),
  upload: (files: File[], tagId?: number) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("images", f));
    if (tagId != null) fd.append("tag", String(tagId));   // attach straight to a tag
    return adminForm<{ created: AdminGalleryPhoto[]; errors: { file: string; error: string }[] }>(
      "gallery-photos/",
      fd,
    );
  },
  deletePhoto: (id: number) => adminDelete(`gallery-photos/${id}/`),
  tags: () => adminGet<AdminGalleryTag[]>("gallery-tags/"),
  createTag: (body: Partial<AdminGalleryTag>) => adminPost<AdminGalleryTag>("gallery-tags/", body),
  updateTag: (id: number, body: Partial<AdminGalleryTag>) =>
    adminPatch<AdminGalleryTag>(`gallery-tags/${id}/`, body),
  deleteTag: (id: number) => adminDelete(`gallery-tags/${id}/`),
  setPhotos: (id: number, photo_ids: number[]) =>
    adminPost<{ count: number }>(`gallery-tags/${id}/set_photos/`, { photo_ids }),
};

export const ORDER_STATUSES = [
  "in_review",
  "pending_payment",
  "confirmed",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
] as const;

// ?sort= values the Orders list offers. Keys must match AdminOrderViewSet.SORTS;
// the default ("status") is the workflow-priority order defined server-side.
export const ORDER_SORTS = [
  { value: "status", label: "Status (workflow order)" },
  { value: "-status", label: "Status (reverse)" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "total_high", label: "Total: high → low" },
  { value: "total_low", label: "Total: low → high" },
  { value: "name", label: "Customer A → Z" },
  { value: "-name", label: "Customer Z → A" },
  { value: "code", label: "Code A → Z" },
  { value: "-code", label: "Code Z → A" },
  { value: "district", label: "District A → Z" },
  { value: "-district", label: "District Z → A" },
  { value: "paid", label: "Paid first" },
  { value: "unpaid", label: "Unpaid first" },
  { value: "courier", label: "Courier booked first" },
  { value: "no_courier", label: "Not booked first" },
  { value: "repeat", label: "Repeat customers first" },
] as const;

// Only unconfirmed/cancelled orders can be hard-deleted (backend enforces too).
export const ORDER_DELETABLE = new Set(["in_review", "pending_payment", "cancelled"]);
export const deleteOrder = (id: number) => adminDelete(`orders/${id}/`);

// Bulk Steadfast sweep: checks only `shipped` orders, flips the delivered ones to
// `delivered`. Batched server-side — `remaining > 0` means press it again.
export type SteadfastSync = {
  checked: number;
  delivered: string[];
  delivered_count: number;
  errors: { uid: string; error: string }[];
  remaining: number;
};
export const syncSteadfast = () => adminPost<SteadfastSync>("orders/sync_steadfast/", {});
// Clears the "new orders" badge/sound — call when the Orders page opens.
export const markOrdersSeen = () => adminPost("orders/mark_seen/", {});

// Web Push: fetch the VAPID public key + register a browser subscription.
export const getPushKey = () => adminGet<{ public_key: string }>("push-key/");
export const pushSubscribe = (sub: unknown) => adminPost("push-subscribe/", sub);
