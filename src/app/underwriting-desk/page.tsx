import type { Metadata } from "next";
import { UnderwritingDesk } from "@/components/UnderwritingDesk";

export const metadata: Metadata = {
  title: "Underwriting Console",
  robots: { index: false, follow: false },
};

export default function UnderwritingDeskPage() {
  return (
    <section className="page-hero desk-page">
      <div className="container">
        <UnderwritingDesk />
      </div>
    </section>
  );
}
