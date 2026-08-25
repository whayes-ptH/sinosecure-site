import type { Metadata } from "next";
import Link from "next/link";
import { SecureUploadPanel } from "@/components/SecureUploadPanel";

export const metadata: Metadata = {
  title: "Secure Document Upload",
  description: "Submit underwriting documents to Sino Secure against your matter reference.",
  robots: { index: false, follow: false },
};

export default async function SecureUploadPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <section className="page-hero secure-page">
      <div className="container secure-layout">
        <div className="secure-intro">
          <p className="eyebrow">Sino Secure underwriting</p>
          <h1 className="secure-title">Secure document upload.</h1>
          <p className="lead">
            Send the package for review. Everything you upload here is bound to the underwriting reference on your
            proposal.
          </p>
          <p>
            Once we have reviewed a complete set of documents we will revert with any clarifying questions and an
            indicative term sheet or consideration proposal.
          </p>
          <p className="form-note">
            If your link has expired or the code is not recognised, contact your underwriter and we will issue a new
            one. You can also start a fresh enquiry from the <Link href="/contact">contact page</Link>.
          </p>
        </div>
        <SecureUploadPanel initialCode={code} autoUnlock />
      </div>
    </section>
  );
}
