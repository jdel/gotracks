import type { SVGProps } from "react";

export function BrandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      data-brand-icon=""
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="#694AAE" />
      <circle cx="27" cy="5" r="11" fill="#71BFB3" />
      <path
        d="M8.5 16.5l5 5L24 10.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
