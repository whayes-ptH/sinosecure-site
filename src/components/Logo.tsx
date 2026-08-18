import Link from "next/link";

export function Logo() {
  return <Link className="brand" href="/" aria-label="Sino Secure home"><svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M5 30c7-10 15-14 25-14 6 0 10 1 14 4-7 1-12 4-16 9-5 5-10 7-16 6-4 0-6-2-7-5Z"/><path className="brand-mark-accent" d="M8 22c6-7 13-11 22-11 5 0 9 1 13 3-8 1-14 5-18 10-4 4-9 6-14 5-4-1-5-4-3-7Z"/></svg><span><strong>Sino Secure</strong><small>Specialty risk · Australia</small></span></Link>;
}
