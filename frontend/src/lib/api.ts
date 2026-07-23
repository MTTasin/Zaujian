// Thin client for the Django API. Base URL from env so dev/prod differ by config.

import { metaTrack, metaTracking } from "./meta";
import { markProgress } from "./progress";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

export type ProductCategory = string;
export type ProductKind = "layered" | "gallery" | "dupatta" | "simple";

export interface ProductListItem {
  id: number;
  name: string;
  slug: string;
  kind: ProductKind;
  category: string;
  base_price: string;
  exclusive_group: string;
  customize_order: number;
  compare_at_price: string | null;
  allows_individual_purchase: boolean;
  is_featured: boolean;
  is_popular: boolean;
  stock: number;
  track_stock: boolean;
  in_stock: boolean;
  is_customizable: boolean;
  thumbnail?: string | null;
  min_price: string;
  max_price: string;
}

export interface ProductImageItem {
  id: number;
  image: string;
  alt: string;
  order: number;
  is_primary: boolean;
}

export interface ProductSpecItem {
  id: number;
  label: string;
  value: string;
  order: number;
}

export interface ComboListItem {
  id: number;
  name: string;
  slug: string;
  /** Free-text label — drives the card badge and the /products filter. */
  category: string;
  price: string;
  featured: boolean;
  thumbnail: string | null;
}

export interface ComboImage {
  id: number;
  image: string;
  order: number;
}

export interface ComboDetail {
  id: number;
  name: string;
  slug: string;
  description: string;
  price: string;
  images: ComboImage[];
  product_slugs: string[];
  /** The pictured design keyed by product slug — seeds the customize wizard. */
  preset_by_slug: Record<string, Record<string, unknown>>;
  /** Admin-defined inputs asked before adding this combo to the cart. */
  input_fields: ProductInputField[];
}

export interface ColorOption {
  id: number;
  name: string;
  base_image: string;
  price_modifier: string;
}

export interface ToppingDesign {
  id: number;
  placement: "corner" | "center";
  image: string;
  pos_x: number;
  pos_y: number;
  scale: number;
  price_modifier: string;
}

export interface GalleryDesign {
  id: number;
  price_modifier: string;
  // pen/mirror use `image`, book inside uses `preview_image`
  image?: string;
  preview_image?: string;
}

export interface DupattaOption {
  id: number;
  lace_type: "single" | "four";
  text_lines: number;
  preview_image: string;
  price: string;
}

export interface ConfigImage {
  color: number | null;
  corner: number | null;
  center: number | null;
  image: string;
}

export interface ProductInputField {
  id: number;
  label: string;
  placeholder: string;
  required: boolean;
  order: number;
}

export interface ProductDetail extends ProductListItem {
  preview_ratio: string;
  description: string;
  images: ProductImageItem[];
  specs: ProductSpecItem[];
  input_fields: ProductInputField[];
  colors: ColorOption[];
  toppings: ToppingDesign[];
  inside_designs: GalleryDesign[];
  static_designs: GalleryDesign[];
  dupatta_options: DupattaOption[];
  config_images: ConfigImage[];
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    // Catalog changes rarely; cache briefly to save bandwidth on slow networks.
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ---- Anonymous cart token (browser only) ------------------------------- //

const CART_TOKEN_KEY = "zaujain_cart_token";

export function getCartToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem(CART_TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(CART_TOKEN_KEY, token);
  }
  return token;
}

async function apiSend<T>(
  path: string,
  method: string,
  body?: unknown,
  isForm = false,
): Promise<T> {
  const headers: Record<string, string> = { "X-Cart-Token": getCartToken() };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`${API_BASE}/api/${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "সমস্যা হয়েছে");
  return data as T;
}

// ---- Cart ------------------------------------------------------------- //

export interface ConfigLine {
  label: string;
  value: string;
  image: string | null;
}

export interface CartLine {
  id: number;
  product: number | null;
  combo: number | null;
  product_name: string;
  product_slug: string;
  category: string;
  config: Record<string, unknown>;
  config_display: ConfigLine[];
  price_snapshot: string;
  is_custom_request: boolean;
  preview_image: string | null;
}

export interface CartState {
  items: CartLine[];
  subtotal: string;
  count: number;
}

export const getCart = () => apiGet2<CartState>("cart/");

// GET with cart token header
async function apiGet2<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    headers: { "X-Cart-Token": getCartToken() },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export const addToCart = (
  slug: string,
  selection: Record<string, number>,
  isCustom = false,
  extras?: { fields?: { label: string; value: string }[]; note?: string },
) =>
  apiSend<CartState>("cart/add/", "POST", {
    slug,
    selection,
    is_custom_request: isCustom,
    ...(extras?.fields?.length ? { fields: extras.fields } : {}),
    ...(extras?.note ? { note: extras.note } : {}),
  }).then((r) => {
    metaTrack("AddToCart", { currency: "BDT" });
    markProgress();
    return r;
  });

export const addComboToCart = (
  comboSlug: string,
  inputs?: { fields?: { label: string; value: string }[]; note?: string },
) =>
  apiSend<CartState>("cart/add/", "POST", { combo_slug: comboSlug, ...(inputs ?? {}) }).then(
    (r) => {
      markProgress();
      return r;
    },
  );

/** Update a combo cart line's answers (price is fixed, nothing to re-price). */
export const editComboCartItem = (
  id: number,
  inputs: { fields?: { label: string; value: string }[]; note?: string },
) => apiSend<CartState>(`cart/${id}/`, "PATCH", inputs);

export const removeCartItem = (id: number) =>
  apiSend<CartState>(`cart/${id}/`, "DELETE");

export const editCartItem = (
  id: number,
  selection: Record<string, number>,
  extras?: { fields?: { label: string; value: string }[]; note?: string },
) =>
  apiSend<CartState>(`cart/${id}/`, "PATCH", {
    selection,
    ...(extras?.fields?.length ? { fields: extras.fields } : {}),
    ...(extras?.note ? { note: extras.note } : {}),
  });

// ---- Shop info / checkout / payment / custom -------------------------- //

export interface ShopInfo {
  delivery_charge: string;
  delivery_charge_inside: string;
  inside_district: string;
  advance_amount: string;
  bkash_number: string;
  nagad_number: string;
  whatsapp_number: string;
}

export const getShopInfo = () => apiGet<ShopInfo>("shop-info/");

export interface OrderResult {
  uid: string;
  advance_required: boolean;
  advance_amount: string;
  subtotal: string;
  delivery_charge: string;
  total: string;
  status: string;
  is_repeat_customer: boolean;
}

export const checkout = (info: {
  customer_name: string;
  phone: string;
  whatsapp: string;
  email: string;
  division: string;
  district: string;
  thana: string;
  address: string;
}) => apiSend<OrderResult>("checkout/", "POST", { ...info, ...metaTracking() });

export interface OrderDetail {
  uid: string;
  customer_name: string;
  phone: string;
  full_address: string;
  subtotal: string;
  delivery_charge: string;
  total: string;
  advance_required: boolean;
  advance_amount: string;
  is_repeat_customer: boolean;
  payment_method: string;
  transaction_id: string;
  status: string;
  status_display: string;
  steadfast_tracking_code?: string;
  items: CartLine[];
}

export const getOrder = (uid: string) => apiGet2<OrderDetail>(`orders/${uid}/`);

export const submitPayment = (uid: string, form: FormData) =>
  apiSend<OrderResult>(`orders/${uid}/payment/`, "POST", form, true);

export const submitCustomRequest = (form: FormData) =>
  apiSend<{ id: number }>("custom-request/", "POST", form, true);

// ---- Chatbot ----
export interface ChatMsg {
  id: number;
  role: "customer" | "bot" | "admin" | "system";
  text: string;
  image: string;
  images: string[];
  more_count: number;
  album_url: string;
  upload: string;
  created_at: string;
}
export interface ChatState {
  session: number;
  status: string;
  messages: ChatMsg[];
}

export const chatSend = (message: string, image?: File) => {
  if (image) {
    const fd = new FormData();
    if (message) fd.append("message", message);
    fd.append("image", image);
    return apiSend<ChatState>("chat/send/", "POST", fd, true);
  }
  return apiSend<ChatState>("chat/send/", "POST", { message });
};

export const chatPoll = (after: number) =>
  apiGet2<ChatState>(`chat/poll/${after ? `?after=${after}` : ""}`);

export interface Album {
  key: string;
  caption: string;
  album_url: string;
  images: string[];
}
export const getAlbum = (key: string) => apiGet<Album>(`album/${key}/`);

export function getProducts(params?: string) {
  return apiGet<ProductListItem[]>(`products/${params ? `?${params}` : ""}`);
}

// ---- Homepage (single call: hero, category tiles, featured, popular) ---- //

export interface SiteContent {
  hero_image: string | null;
  hero_title: string;
  hero_subtitle: string;
  band_image: string | null;
}
export interface HomeCategoryItem {
  id: number;
  title: string;
  image: string | null;
  link: string;
  order: number;
}
export interface HomeData {
  site: SiteContent;
  categories: HomeCategoryItem[];
  featured: ProductListItem[];
  popular: ProductListItem[];
}
export const getHome = () => apiGet<HomeData>("home/");

export function getProduct(slug: string) {
  return apiGet<ProductDetail>(`products/${slug}/`);
}

export function getCombos(featuredOnly = false) {
  return apiGet<ComboListItem[]>(`combos/${featuredOnly ? "?featured=1" : ""}`);
}

export function getCombo(slug: string) {
  return apiGet<ComboDetail>(`combos/${slug}/`);
}

export async function priceSelection(
  slug: string,
  selection: Record<string, number>,
): Promise<{ price: string; config: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/api/products/${slug}/price/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "দাম বের করা যায়নি");
  }
  return res.json();
}

// ---- Visitor help-nudge counters (best-effort, never blocks the page) ---- //

export const postNudgeEvent = (type: "visit" | "shown" | "clicked") =>
  apiSend<{ ok: boolean }>("nudge-event/", "POST", { type }).catch(() => null);

// Absolute media URL helper (Django serves relative media paths).
export function mediaUrl(path?: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}
