import { API_BASE } from "./api";

export type GalleryTagTile = {
  slug: string;
  title: string;
  cover: string;
  count: number;
};

export type GalleryPhoto = {
  id: number;
  thumb: string;
  full: string;
  caption: string;
  alt: string;
};

export type GalleryDetail = {
  title: string;
  description: string;
  photos: GalleryPhoto[];
};

export async function fetchGalleryIndex(): Promise<GalleryTagTile[]> {
  try {
    const r = await fetch(`${API_BASE}/api/gallery/`, { next: { revalidate: 300 } });
    if (!r.ok) return [];
    return r.json();
  } catch {
    return [];
  }
}

export async function fetchGalleryTag(slug: string): Promise<GalleryDetail | null> {
  try {
    const r = await fetch(`${API_BASE}/api/gallery/${slug}/`, { next: { revalidate: 300 } });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}
