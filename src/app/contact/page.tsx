import type { Metadata } from "next";
import { UnderwritingPortal } from "@/components/UnderwritingPortal";

export const metadata: Metadata = { alternates: { canonical: "/contact" },
  title: "Underwriting Enquiry",
  description:
    "Contact Sino Secure about marine, financial guarantee, indemnity, liability and specialty risks, and submit underwriting documents through our secure upload portal.",
};

export default function ContactPage() {
  return <UnderwritingPortal />;
}
