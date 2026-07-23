// Central SEO config — site metadata, keywords, structured data (JSON-LD).

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://zaujain.xyz"
).replace(/\/$/, "");

export const SITE_NAME = "Zaujain Nikah Point";

export const SITE_DESC =
  "কাস্টম নিকাহনামা, নিকাহনামা কম্বো, ফ্রেম, বক্স, মিরর ও বিয়ের গিফট — প্রিমিয়াম মানের, সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।";

export const OG_IMAGE = "/Logo.png";

export const KEYWORDS = [
  "নিকাহনামা", "নিকাহনামা কম্বো", "কাস্টম নিকাহনামা", "নিকাহনামা ফ্রেম",
  "নিকাহনামা বক্স", "বিয়ের নিকাহনামা", "নিকাহনামা সেট", "নিকাহনামা গিফট",
  "নিকাহনামা ডিজাইন", "প্রিমিয়াম নিকাহনামা", "নিকাহনামা মিরর", "বিয়ের উপহার",
  "নিকাহ গিফট", "আকদ গিফট", "নিকাহনামা বাংলাদেশ",
  "Nikah Nama", "custom Nikah Nama", "Nikah Nama box", "Nikah Nama frame",
  "Nikah Nama Bangladesh", "Nikah Nama combo", "personalized Nikah Nama",
  "wedding gift Bangladesh", "Zaujain Nikah Point",
];

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    "@id": `${SITE_URL}/#store`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/Logo.png`,
    image: `${SITE_URL}/Logo.png`,
    description: SITE_DESC,
    telephone: "+8801959976683",
    email: "mttasinpayment@gmail.com",
    priceRange: "৳৳",
    currenciesAccepted: "BDT",
    paymentAccepted: "Cash on Delivery, bKash, Nagad",
    address: {
      "@type": "PostalAddress",
      streetAddress:
        "G.A Bhaban (Unit-1), In front of Anderkillah Shahi Jame Mosjid, Anderkillah",
      addressLocality: "Chattogram",
      addressRegion: "Chattogram",
      addressCountry: "BD",
    },
    geo: { "@type": "GeoCoordinates", latitude: 22.3384, longitude: 91.8317 },
    openingHoursSpecification: [{
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: "05:00", closes: "23:00",
    }],
    sameAs: [
      "https://www.facebook.com/ZaujainNikahPoint",
      "https://www.instagram.com/zaujainnikahpoint/",
    ],
    areaServed: { "@type": "Country", name: "Bangladesh" },
  };
}

/** FAQPage structured data — eligible for the FAQ rich result in Google. */
export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** BreadcrumbList — powers breadcrumb rich results + clarifies hierarchy. */
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    inLanguage: "bn-BD",
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/products?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}
