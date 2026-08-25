import Link from "next/link";

/**
 * The Sino Secure crest: a gold-rimmed navy shield carrying the dragon and the
 * padlock. Drawn as vector so it stays crisp at favicon size and needs no
 * background — the header and footer are both dark navy.
 */
export function ShieldMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false">
      {/* shield rim, then the field it encloses */}
      <path
        fill="#e8c477"
        d="M24 3.5 41.5 8.6 41.5 24.8C41.5 34.2 33.6 41.6 24 45.5 14.4 41.6 6.5 34.2 6.5 24.8L6.5 8.6Z"
      />
      <path
        fill="#0c2c4a"
        d="M24 6.8 38.4 11 38.4 24.7C38.4 32.4 31.8 38.7 24 42.1 16.2 38.7 9.6 32.4 9.6 24.7L9.6 11Z"
      />

      {/* dragon: tail at lower left, body coiling up and over, head facing right */}
      <g fill="#cfa14e" transform="translate(3.36 2.835) scale(0.86)">
        <path d="M12.6 27.5C11.8 19.4 16.4 12.6 23.6 11.2 27.4 10.5 30.6 11.3 32.8 13L31 15.8C29.2 14.6 26.8 14.2 24.2 14.7 18.6 15.8 15.2 21.2 15.9 27.6Z" />
        <path d="M12.6 27.5 11.1 31.6 16.3 30.2 15.9 27.6Z" />
        <path d="M32.8 13 37.2 13.6 36 15.4 37 17.2 33.4 16.8 31 15.8Z" />
        <path d="M32.6 13.1 32 9.3 34.8 12.9Z" />
        <path d="M12.9 23.4 10.8 22.3 13.2 21Z" />
        <path d="M16.2 17 14.5 15.1 17.4 14.8Z" />
        <path d="M22.2 12.6 21.3 10.3 24 11.2Z" />
        <circle cx="33.5" cy="14.3" r="0.6" fill="#0c2c4a" />
      </g>

      {/* padlock, sitting clear of the dragon so both read at favicon size */}
      <path
        fill="none"
        stroke="#cfa14e"
        strokeWidth="2.4"
        strokeLinecap="round"
        d="M20.4 28.6V25.6C20.4 23.6 22 22 24 22 26 22 27.6 23.6 27.6 25.6V28.6"
      />
      <rect x="18.6" y="28" width="10.8" height="9.6" rx="1.5" fill="#e8c477" />
      <circle cx="24" cy="31.4" r="1.5" fill="#0c2c4a" />
      <path fill="#0c2c4a" d="M23 32.5H25L24.5 35.4H23.5Z" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link className="brand" href="/" aria-label="Sino Secure home">
      <ShieldMark />
      <span>
        <strong>Sino Secure</strong>
        <small>Specialty risk · Australia</small>
      </span>
    </Link>
  );
}
