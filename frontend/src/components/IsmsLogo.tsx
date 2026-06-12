import React from 'react';

interface Props {
  size?: number;
  className?: string;
}

export const IsmsLogo: React.FC<Props> = ({ size = 36, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    width={size}
    height={size}
    className={className}
    aria-label="OpenISMS"
  >
    <defs>
      <linearGradient id="ismsLgBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#1e3a8a" />
        <stop offset="100%" stopColor="#0c1445" />
      </linearGradient>
      <linearGradient id="ismsLgSh" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#93c5fd" />
        <stop offset="45%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#1d4ed8" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="100" fill="url(#ismsLgBg)" />
    <path
      d="M168 94H344Q398 94 398 148V272C398 384 318 434 256 440C194 434 114 384 114 272V148Q114 94 168 94Z"
      fill="#1d4ed8"
      opacity="0.35"
      transform="translate(0,10)"
    />
    <path
      d="M168 88H344Q396 88 396 142V268C396 380 316 430 256 436C196 430 116 380 116 268V142Q116 88 168 88Z"
      fill="url(#ismsLgSh)"
    />
    <path
      d="M180 110H332Q376 110 376 154V268C376 366 308 410 256 418"
      fill="none"
      stroke="rgba(255,255,255,0.22)"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M190 268L190 234A66 66 0 0 1 322 234L322 268"
      fill="none"
      stroke="white"
      strokeWidth="28"
      strokeLinecap="round"
    />
    <rect x="168" y="260" width="176" height="118" rx="22" fill="white" />
    <circle cx="256" cy="304" r="23" fill="#2563eb" />
    <rect x="247" y="322" width="18" height="30" rx="6" fill="#2563eb" />
  </svg>
);
