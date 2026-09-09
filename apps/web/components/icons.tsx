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

export const LadderIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="#8fe0c0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h4v-7H4zM10 20h4V4h-4zM16 20h4v-11h-4z" />
  </svg>
);

/** Two figures under one banner. The rail button for clans. */
export function ClanIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M17 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M2 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
      <path d="M18 14a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

/* --- the world outside the game ---------------------------------------- */

export const XIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden>
    <path
      d="M17.6 3h3.2l-7 8 8.2 10h-6.4l-5-6.1L4.8 21H1.6l7.5-8.6L1.2 3h6.6l4.5 5.6zm-1.1 16h1.8L7.6 4.9H5.7z"
      fill="currentColor"
    />
  </svg>
);

export const TelegramIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden>
    <path
      d="M21.6 4.2 2.9 11.3c-1 .4-1 1.8.1 2.1l4.5 1.4 1.7 5.2c.3.9 1.4 1.1 2 .4l2.5-2.6 4.6 3.4c.8.6 1.9.2 2.1-.8l3-14.2c.2-1-.8-1.8-1.8-1.4zM8.9 14.5l9-5.6-7.5 6.9-.3 3.4z"
      fill="currentColor"
    />
  </svg>
);

/**
 * Concentric arcs over a tower: the reach of a defence.
 *
 * Drawn as rings rather than a target, because a target reads as "aim here"
 * and this button means "show me what is covered".
 */
export const RangeIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 13v7" />
    <path d="M9 20h6" />
    <circle cx="12" cy="10" r="2.4" fill={on ? 'currentColor' : 'none'} />
    <path d="M7.4 5.4a6.5 6.5 0 0 0 0 9.2" opacity={on ? 1 : 0.55} />
    <path d="M16.6 5.4a6.5 6.5 0 0 1 0 9.2" opacity={on ? 1 : 0.55} />
    <path d="M4.6 2.6a10.5 10.5 0 0 0 0 14.8" opacity={on ? 0.8 : 0.28} />
    <path d="M19.4 2.6a10.5 10.5 0 0 1 0 14.8" opacity={on ? 0.8 : 0.28} />
  </svg>
);

/**
 * Hit points and damage a second, for the cards where a player is choosing.
 *
 * Drawn rather than labelled "HP" and "DPS": the two numbers sit side by side
 * on a card barely wider than a thumb, and two glyphs read faster than two
 * abbreviations in any language.
 */
export const HeartIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <path
      d="M12 20S3.5 14.4 3.5 9.2A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.5 2.6C20.5 14.4 12 20 12 20z"
      fill="#e05b4a" stroke="#7d2a20" strokeWidth="1.4" strokeLinejoin="round"
    />
    <path d="M8.4 8.2a2.6 2.6 0 0 1 2.2-1.4" fill="none" stroke="#ff9c8c" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const BladeIcon = () => (
  <svg viewBox="0 0 24 24" width="1em" height="1em">
    <path d="M18.6 3.4l2 2-9 9-2.6.6.6-2.6z" fill="#dbe6f2" stroke="#4c5c6e" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9.6 12.4l2 2" fill="none" stroke="#4c5c6e" strokeWidth="1.2" />
    <path d="M7.6 15l1.4 1.4-3.2 3.2-2.2.8.8-2.2z" fill="#c08a3e" stroke="#6b4a1c" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);
