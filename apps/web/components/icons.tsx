/** Inline SVG icons, ported from the prototype. No sprite sheet, no icon font. */

export const GoldIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <ellipse cx="12" cy="16.5" rx="8.5" ry="4.2" fill="#a8761b" />
    <ellipse cx="12" cy="14" rx="8.5" ry="4.2" fill="#e8b23c" stroke="#7d5310" strokeWidth="1.3" />
    <ellipse cx="12" cy="9.6" rx="8.5" ry="4.2" fill="#ffd25c" stroke="#7d5310" strokeWidth="1.3" />
    <ellipse cx="12" cy="9" rx="4.4" ry="2" fill="#ffe9a8" />
  </svg>
);

export const IronIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <path d="M4 15l4-7h8l4 7-4 5H8z" fill="#9fb0c2" stroke="#4c5c6e" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8 8l4 7 4-7" fill="none" stroke="#4c5c6e" strokeWidth="1.2" />
    <path d="M8 8l-4 7h8z" fill="#c3d2e0" />
  </svg>
);

export const TrophyIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="#e8b23c" stroke="#7d5310" strokeWidth="1.3" />
    <path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" fill="none" stroke="#7d5310" strokeWidth="1.3" />
    <path d="M10 14h4v3h-4z" fill="#a8761b" />
    <rect x="7.5" y="17" width="9" height="2.6" rx="1" fill="#e8b23c" stroke="#7d5310" strokeWidth="1.2" />
  </svg>
);

export const StarIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <path
      d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z"
      fill={on ? '#ffd25c' : '#2a374d'}
      stroke={on ? '#a8761b' : '#46608a'}
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export const HomeIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#ffd97a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 3 10v11h6v-6h6v6h6V10z" />
  </svg>
);

export const BuildIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#8fe07a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6" />
  </svg>
);

export const ArmyIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#9fc4ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 3.5 20 9l-9.5 9.5M4 20l4-4M3.5 9.5 9 4l9.5 9.5L13 19z" />
  </svg>
);

export const OrdersIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#ffd97a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M9 12h7M9 16h5M9 8h4" />
  </svg>
);

export const LogIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#ff9a86" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M9 13l2.5 2.5L16 11" />
  </svg>
);

export const RaidIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#ffe2d8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4l7 7M8 4H4v4M20 4l-7 7M16 4h4v4M9 15l-5 5M4 16v4h4M15 15l5 5M20 16v4h-4" />
  </svg>
);

export const SoundIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke={on ? '#ffd97a' : '#7d8ea6'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9v6h4l5 4V5L8 9z" fill={on ? '#ffd97a' : '#7d8ea6'} />
    {on ? (
      <>
        <path d="M16.5 8.5a5 5 0 0 1 0 7" />
        <path d="M19 6a8.5 8.5 0 0 1 0 12" />
      </>
    ) : (
      <path d="M17 9.5l4 5M21 9.5l-4 5" />
    )}
  </svg>
);

export const BuilderIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#ffd97a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 6l4 4-8 8-4-4z" />
    <path d="M17 3l4 4-3 3-4-4z" />
    <path d="M6 14l-3 3v4h4l3-3" />
  </svg>
);
