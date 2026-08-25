import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return <footer className="site-footer"><div className="container footer-grid"><div className="footer-brand"><Logo /><p>Specialty insurance thinking for businesses moving value across borders.</p></div><div><h3>Explore</h3><Link href="/#solutions">Solutions</Link><Link href="/#sectors">Sectors</Link><Link href="/contact">Underwriting enquiry</Link><Link href="/contact#secure-upload">Secure document upload</Link></div><div><h3>Legal</h3><Link href="/privacy-policy">Privacy policy</Link><Link href="/terms-of-service">Terms of use</Link></div><div><h3>Australia office</h3><p>Suite 7, 334 Highbury Road<br />Mount Waverley VIC 3149<br />Australia</p></div></div><div className="container footer-bottom"><p>© {new Date().getFullYear()} Sino Secure Pty Ltd.</p><p>Coverage is subject to underwriting, policy terms, exclusions and jurisdictional availability.</p></div></footer>;
}
