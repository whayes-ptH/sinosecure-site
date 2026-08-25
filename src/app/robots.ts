import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: "/", disallow: ["/secure-upload/", "/underwriting-desk", "/api/"] }, sitemap: "https://sinosecure.eu/sitemap.xml" }; }
