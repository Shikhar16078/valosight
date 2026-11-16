import { useId } from "react";

export const APP_NAME = "Valosight";
export const AUTHOR = "King KsK";

/** The mark: a V with an aim dot in its notch, like looking down a sight. */
export function Logo({ size = 26 }: { size?: number }) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--accent) 55%, var(--violet))" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${g})`} />
      <path d="M7 8h4.6L16 20.4 20.4 8H25l-6.6 17h-4.8z" fill="#fff" />
      <circle cx="16" cy="10.4" r="1.9" fill="#fff" />
    </svg>
  );
}

/** "VALOSIGHT" with the second half in the accent colour, and an optional "by KsK" underneath. */
export function Wordmark({ by = false, className = "" }: { by?: boolean; className?: string }) {
  return (
    <span className={`inline-flex flex-col items-start text-left leading-none ${className}`}>
      <span className="font-display font-bold tracking-wide">
        VALO<span className="text-accent">SIGHT</span>
      </span>
      {by && <span className="mt-0.5 text-[9.5px] font-medium tracking-[0.18em] text-muted">BY KSK</span>}
    </span>
  );
}
