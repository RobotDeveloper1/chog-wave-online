export const GAME_W = 960;
export const GAME_H = 540;

export const PALETTE = {
  bg: 0x0b0714,
  far: 0x180f2b,
  mid: 0x2a1a4a,
  near: 0x3d2a66,
  glow: 0x8b7bb8,
  fur: 0xf2e3d0,
  pink: 0xe8547c,
  purple: 0x6b3fa0,
  volt: 0x7cf2e0,
  warn: 0xff4d6d,
  storm: 0xb04dff,
};

export const SERVER_HTTP = import.meta.env.VITE_SERVER ?? '';
export const SERVER_WS =
  import.meta.env.VITE_WS ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
