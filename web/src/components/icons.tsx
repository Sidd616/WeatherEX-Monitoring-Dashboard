// Generic (non-status) chrome icons — expand/collapse chevrons and the like.
// Status glyphs live in StatusIcon.tsx; these are unrelated to severity.

interface IconProps {
  size?: number;
  className?: string;
}

export function ChevronRightIcon({ size = 16, className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
