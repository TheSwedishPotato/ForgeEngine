const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

export const PlayIcon = () => (
  <svg {...base}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...base}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const PrevIcon = () => (
  <svg {...base}>
    <rect x="5" y="5" width="2.5" height="14" rx="1" />
    <path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9 13a1.2 1.2 0 0 1 0-2l8.45-5.63A1 1 0 0 1 19 6.2Z" />
  </svg>
);

export const NextIcon = () => (
  <svg {...base}>
    <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    <path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L15 13a1.2 1.2 0 0 0 0-2L6.55 5.37A1 1 0 0 0 5 6.2Z" />
  </svg>
);
