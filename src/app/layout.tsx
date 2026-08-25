import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = { metadataBase: new URL("https://sinosecure.eu"), title: { default: "Sino Secure | Specialty Insurance for Global Trade", template: "%s | Sino Secure" }, description: "Marine, cargo, financial guarantee, indemnity and liability solutions for companies operating across borders.", alternates: { canonical: "/" }, openGraph: { type: "website", url: "https://sinosecure.eu", siteName: "Sino Secure", images: [{ url: "/hero.webp", width: 1600, height: 900 }] }, icons: { icon: "/favicon.png" } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><Header /><main>{children}</main><Footer /></body></html>; }
