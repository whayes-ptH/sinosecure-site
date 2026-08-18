import Link from "next/link";
import { Logo } from "./Logo";

const links = [
  ["Solutions", "/#solutions"],
  ["Sectors", "/#sectors"],
  ["Why Sino", "/#about"],
  ["Global network", "/#network"],
];

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary navigation">
          {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <Link className="button button-small desktop-cta" href="/contact">Request underwriting</Link>
        <details className="mobile-menu">
          <summary aria-label="Open navigation"><span></span><span></span><span></span></summary>
          <nav aria-label="Mobile navigation">
            {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
            <Link href="/contact">Request underwriting</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
