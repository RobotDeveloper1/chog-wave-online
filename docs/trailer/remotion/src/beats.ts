export type Beat = {
  key: string;
  file: string; // under public/shots
  in: number; // seconds into the take
  dur: number; // seconds of the beat
  title: string;
  sub: string;
  rate?: number; // playback rate when the take is shorter than the beat
  zoom?: boolean; // punch-in cutaway (reused footage reads as a new angle)
};

export const OPEN_DUR = 6.0;
export const END_DUR = 4.0;

// Order = trailer order. dur = VO + ~1s breathing room, except 17/18 (the arc needs the tail).
export const BEATS: Beat[] = [
  { key: '01', file: '01-login.mp4', in: 0.3, dur: 6.2, title: 'CONNECT YOUR WALLET', sub: '1,969 chogs live on monad' },
  { key: '02', file: '01-login.mp4', in: 0.5, dur: 4.8, title: 'PICK YOUR FIGHTER', sub: 'every token modeled in 3d', zoom: true },
  { key: '03', file: '03-street.mp4', in: 0.5, dur: 4.4, title: 'GENESIS CITY', sub: 'quests · boards · traffic' },
  { key: '04', file: '04-line.mp4', in: 2.5, dur: 5.1, title: 'THE TOLLS', sub: 'past the line, things bite' },
  { key: '05', file: '05-pack.mp4', in: 1.0, dur: 3.2, title: 'PACKS', sub: 'they hunt in threes' },
  { key: '06', file: '06-ambush.mp4', in: 0.4, dur: 4.3, title: 'AMBUSH', sub: 'step in the red, pay the price' },
  { key: '07', file: '07-duel.mp4', in: 6.0, dur: 4.5, title: 'DUEL', sub: 'six cards · one element' },
  { key: '08', file: '08-drops.mp4', in: 1.0, dur: 4.1, title: 'DROPS', sub: 'kills pay in cardboard' },
  { key: '09', file: '09-reward.mp4', in: 0.5, dur: 3.3, title: 'REWARD', sub: 'straight into your deck' },
  { key: '10', file: '10-sheet.mp4', in: 0.2, dur: 5.1, title: 'TRAITS ARE STATS', sub: 'head · mouth · pwr' },
  { key: '11', file: '11-deck.mp4', in: 0.5, dur: 3.5, title: 'DECK BUILDER', sub: 'tune the sixty' },
  { key: '12', file: '12-trade.mp4', in: 0, dur: 3.5, title: 'MARKET', sub: 'buy low · duel high' },
  { key: '13', file: '13-anomaly.mp4', in: 0, dur: 5.4, title: 'THE ANOMALY', sub: 'collection volume wakes it' },
  { key: '14', file: '14-dungeon.mp4', in: 1.0, dur: 5.1, title: 'DUNGEONS', sub: 'bring friends or bandages' },
  { key: '15', file: '15-party.mp4', in: 0.3, dur: 3.6, title: 'PARTY UP', sub: 'cover · revive · repeat' },
  { key: '16', file: '16-ranks.mp4', in: 0.5, dur: 3.2, title: 'RANKS', sub: 'somebody has to be first' },
  { key: '17', file: '17-callout.mp4', in: 1.0, dur: 6.5, title: 'CALLOUT', sub: 'two chogs enter' },
  { key: '18', file: '18-bout.mp4', in: 27, dur: 12.0, title: 'BOUT', sub: 'winner takes the pot' },
];
