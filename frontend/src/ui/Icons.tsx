import type { SVGProps } from "react";

/** One authored set: 20px box, 1.75 stroke, round caps. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const ChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12.5 4.5 7 10l5.5 5.5" />
  </Icon>
);

export const ChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7.5 4.5 13 10l-5.5 5.5" />
  </Icon>
);

export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="7.25" y="2.75" width="5.5" height="9.5" rx="2.75" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
  </Icon>
);

export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="5" y="5" width="10" height="10" rx="1.5" />
  </Icon>
);

export const ConversationIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5Z" />
    <path d="M6 7.5h8M6 10.5h5" />
  </Icon>
);

export const ExternalIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon width="14" height="14" {...p}>
    <path d="M8 4.5H4.75v10.75H15.5V12M11 4.5h4.5V9M15.5 4.5 9 11" />
  </Icon>
);

/** The wordmark's emblem: a 2x2 board corner with one marked square. */
export const Emblem = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="20" height="20" rx="2" fill="#F0D9B5" stroke="#F0D9B5" strokeWidth="1" />
    <rect x="11" y="1" width="10" height="10" fill="#B58863" />
    <rect x="1" y="11" width="10" height="10" fill="#B58863" />
    <circle cx="16" cy="16" r="3.25" fill="#D7263D" />
  </svg>
);
