import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap { const base="https://sinosecure.eu"; return ["","/contact","/privacy-policy","/terms-of-service"].map((p)=>({url:base+p,lastModified:new Date(),changeFrequency:p===""?"monthly":"yearly",priority:p===""?1:0.5})); }
