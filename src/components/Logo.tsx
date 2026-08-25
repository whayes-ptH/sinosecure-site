import Image from "next/image";
import Link from "next/link";

export function Logo() {
  return (
    <Link className="brand" href="/" aria-label="Sino Secure home">
      <Image className="brand-mark" src="/logo.png" alt="Sino Secure" width={41} height={44} priority />
      <span>
        <strong>Sino Secure</strong>
        <small>Specialty risk · Australia</small>
      </span>
    </Link>
  );
}
