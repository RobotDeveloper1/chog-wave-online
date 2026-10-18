/**
 * Inline SVG icons for the HUD. Drawn on a 24px grid in `currentColor`, so one string
 * serves every tint — an element colour, a tier colour, a dimmed state — without a
 * second asset, and nothing is fetched from anywhere.
 */

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="currentColor" stroke-width="0" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

const line = (body: string, w = 2): string =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  burn: svg('<path d="M12 2c1 4 5.2 6.2 5.2 11.2a5.2 5.2 0 0 1-10.4 0c0-2.1 1-3.4 2.2-4.5.1 2 1 3 2.2 3.2C10.6 8.4 10.6 5.2 12 2z"/>'),
  frost: line('<path d="M12 2.5v19M4 7.2l16 9.6M20 7.2L4 16.8M9.5 4.2L12 6.6l2.5-2.4M9.5 19.8L12 17.4l2.5 2.4"/>', 1.9),
  volt: svg('<path d="M13.5 2L5 13.6h5.8L9.8 22 19 10.2h-6z"/>'),
  wave: line('<path d="M2.5 12.5c2.2-5 4.2-5 6.2 0s4 5 6.2 0 4-5 6.1 0"/>', 2.4),
  prism: svg('<path d="M12 2l8 9.8-8 10.2-8-10.2z"/><path d="M4 11.8h16M12 2v20" stroke="#000" stroke-opacity=".28" stroke-width="1.2"/>'),
  void: line('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6" fill="currentColor"/>', 2),
  wav: line('<path d="M12 2.6l8.4 4.8v9.2L12 21.4l-8.4-4.8V7.4z"/><path d="M8 9.2l1.9 5.8 2.1-4.4 2.1 4.4 1.9-5.8"/>', 1.8),
  heart: svg('<path d="M12 21s-8.2-5.2-8.2-11.2A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.2 2.6C20.2 15.8 12 21 12 21z"/>'),
  star: svg('<path d="M12 2l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 18l-6.4 3.6L7 14.5 1.7 9.5l7.2-.9z"/>'),
  eye: line('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  pin: line('<path d="M12 22s7-6.4 7-12.2a7 7 0 1 0-14 0C5 15.6 12 22 12 22z"/><circle cx="12" cy="9.8" r="2.4" fill="currentColor"/>'),
  scroll: line('<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M9 8h7M9 12h7M9 16h4"/>'),
  bag: line('<path d="M5.2 9h13.6l1 12H4.2z"/><path d="M9 9V7.2a3 3 0 0 1 6 0V9"/>'),
  menu: svg('<rect x="3" y="3" width="7.4" height="7.4" rx="1.6"/><rect x="13.6" y="3" width="7.4" height="7.4" rx="1.6"/><rect x="3" y="13.6" width="7.4" height="7.4" rx="1.6"/><rect x="13.6" y="13.6" width="7.4" height="7.4" rx="1.6"/>'),
  chat: line('<path d="M4 5h16v11H9.5L4 20.5z"/>'),
  med: svg('<path d="M9.8 3h4.4v6.8H21v4.4h-6.8V21H9.8v-6.8H3V9.8h6.8z"/>'),
  repair: svg('<path d="M14.8 5.2a4.2 4.2 0 0 0-5.6 5.3L3 16.7 7.3 21l6.2-6.2a4.2 4.2 0 0 0 5.3-5.6l-2.8 2.8-2.5-.7-.7-2.5z"/>'),
  amp: svg('<path d="M12 2.5l7.5 8.5h-4.3v10H8.8V11H4.5z"/>'),
  ward: svg('<path d="M12 2l8 3v6.2c0 5-3.4 9-8 10.8-4.6-1.8-8-5.8-8-10.8V5z"/>'),
  scan: line('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.4"/><path d="M12 12l6.2-6.2"/>'),
  pack: line('<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
  gate: line('<path d="M4 12h14M13 6l6 6-6 6"/>', 2.4),
  door: line('<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3.5 21h17"/><circle cx="14.4" cy="12.4" r="1" fill="currentColor"/>'),
  skull: svg('<path d="M12 2.5a8.2 8.2 0 0 0-8.2 8.2c0 2.8 1.4 4.6 3.2 5.8V20h2.6v-2h4.8v2H17v-3.5c1.8-1.2 3.2-3 3.2-5.8A8.2 8.2 0 0 0 12 2.5zM8.7 12.6a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zm6.6 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z"/>'),
  bolt: svg('<path d="M13.5 2L5 13.6h5.8L9.8 22 19 10.2h-6z"/>'),
  check: line('<path d="M4.5 12.5l5 5 10-11"/>', 2.8),
  sparkle: svg('<path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
} as const;

export type IconName = keyof typeof ICON;

/** The six element glyphs, keyed the way the rest of the game keys them. */
export const ELEMENT_ICON: Record<string, string> = {
  burn: ICON.burn,
  frost: ICON.frost,
  volt: ICON.volt,
  wave: ICON.wave,
  prism: ICON.prism,
  void: ICON.void,
};

/**
 * The six waves. These are only ever written into a `--c` hand property, so they name the
 * stylesheet's tokens rather than repeating hexes the CSS would not have heard about. The WebGL
 * side has its own literal copy in battle.ts, where a `var()` would not parse.
 */
export const ELEMENT_COLOUR: Record<string, string> = {
  burn: 'var(--burn)',
  frost: 'var(--frost)',
  volt: 'var(--volt)',
  wave: 'var(--wave)',
  prism: 'var(--prism)',
  void: 'var(--void)',
};

/** Items in the bag, as the hotbar draws them. */
export const ITEM_ICON: Record<string, string> = {
  med: ICON.med,
  repair: ICON.repair,
  amp: ICON.amp,
  ward: ICON.ward,
  scan: ICON.scan,
  pack: ICON.pack,
};
