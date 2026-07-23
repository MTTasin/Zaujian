// Admin panel API client. Token auth stored in localStorage. English UI.

import { API_BASE } from "./api";

const TOKEN_KEY = "zaujain_admin_token";

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
  const res = await fetch(`${API_BASE}/api/admin/${path}`, {
    method, headers, body: payload, cache: "no-store",
  });
  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined") window.location.href = "/admin/login";
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

export interface DashboardData {
  orders_today: number;
  pending_payment: number;
  pending_custom: number;
  total_orders: number;
  total_profit: number;
  uncosted_count: number;
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
  product_name: string;
  category: string;
  price_snapshot: string;
  is_custom_request: boolean;
  preview_image: string | null;
  config: ItemConfig;
  config_display: ConfigLine[];
}

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
  cost_price: string | null;
  profit: string | null;
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
  items: AdminOrderItem[];
  extra_consignments: ExtraConsignment[];
}

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
  "pending_payment",
  "confirmed",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
] as const;

// Only pending/cancelled orders can be hard-deleted (backend enforces too).
export const ORDER_DELETABLE = new Set(["pending_payment", "cancelled"]);
export const deleteOrder = (id: number) => adminDelete(`orders/${id}/`);
// Clears the "new orders" badge/sound — call when the Orders page opens.
export const markOrdersSeen = () => adminPost("orders/mark_seen/", {});

// Web Push: fetch the VAPID public key + register a browser subscription.
export const getPushKey = () => adminGet<{ public_key: string }>("push-key/");
export const pushSubscribe = (sub: unknown) => adminPost("push-subscribe/", sub);
