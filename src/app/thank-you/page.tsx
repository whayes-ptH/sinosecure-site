import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

import Link from "next/link";
export default function ThankYou(){return <section className="page-hero centered"><div className="container"><p className="eyebrow">Enquiry received</p><h1>Thank you.</h1><p className="lead">Your submission has been received. This acknowledgement does not bind or confirm coverage.</p><Link className="button" href="/">Return home</Link></div></section>}
