import { objective as O, STORY, type QuestDef, type QuestLog } from './quest.ts';

/**
 * The people's quests.
 *
 * The main road (`STORY`) sends you across the whole city; these are the errands the city
 * itself asks for. Each is a person with a problem who lives somewhere specific, and each
 * is finished by *going* — to a place, a door, another person — never by pressing a
 * button on a menu. That is the whole design rule: if a quest can be finished without
 * leaving the screen it is on, it is not a quest, it is a checklist.
 *
 * Levels make the book a ladder: the errands here are for level 1–3, and the dungeons take
 * over from there, so a new player always has something in reach and a veteran
 * always has somewhere left to go.
 */

export const SIDE: QuestDef[] = [
  // ---------------------------------------------------------------- ASHFLAT
  {
    id: 's-a-bread',
    name: 'Warm Bread',
    giver: 'a-baker',
    kind: 'side',
    sector: 'ashflat',
    text: 'Two loaves, still warm. One for the Noodle Cook, one for old Elder Spark up on Hillside Row. They will both pretend they never asked.',
    doing: 'Noodle Cook on the main street, Elder Spark on Hillside Row. Bread goes cold.',
    thanks: 'Both delivered? Good. Bread first, then the end of the world.',
    stars: 1,
    objectives: [O('talk', 1, { target: 'a-noodle' }), O('talk', 1, { target: 'a-elder' })],
    reward: { wav: 60, items: { med: 1 } },
  },
  {
    id: 's-a-clock',
    name: 'What Time Is It?',
    giver: 'a-clock',
    kind: 'side',
    sector: 'ashflat',
    text: 'My clock stopped when the first anomaly came through. From the Ridge Lookout, up north-east, you can read the sun. Go and tell me what time it really is.',
    doing: 'The Ridge Lookout is on the north-east edge of the city, above Ridge Row.',
    thanks: 'Later than I thought. It always is.',
    stars: 1,
    objectives: [O('reach', 1, { target: 'a-vista' })],
    reward: { wav: 80 },
  },
  {
    id: 's-a-spring',
    name: 'The Hidden Spring',
    giver: 'a-gardener',
    kind: 'side',
    sector: 'ashflat',
    level: 2,
    text: 'There is a spring behind the bandstand in these gardens, and the water tastes faintly of static. Find it for me. And while you are looking, catch two Mystery Waves — put the Visualizer on (V).',
    doing: 'Behind the bandstand. Press V to see the Mystery Waves.',
    thanks: 'Static in the water. I knew it. Thank you.',
    stars: 1,
    objectives: [O('reach', 1, { target: 'a-spring' }), O('collect', 2)],
    reward: { wav: 90, items: { scan: 1 } },
  },
  {
    id: 's-a-canal',
    name: 'What the Canal Keeps',
    giver: 'a-fisher',
    kind: 'side',
    sector: 'ashflat',
    text: 'The canal keeps what the street loses. Walk the bridge for me — I cannot any more. Then ask the Scrapper what he pulled out of the water last week.',
    doing: 'The bridge is in the middle of the canal. The Scrapper works the Scrap Lot, south-east.',
    thanks: 'So that is where my hook went.',
    stars: 1,
    objectives: [O('reach', 1, { target: 'a-bridge' }), O('talk', 1, { target: 'a-scrapper' })],
    reward: { wav: 80, items: { pack: 1 } },
  },
  {
    id: 's-a-rails',
    name: 'The Last Train',
    giver: 'a-engineer',
    kind: 'side',
    sector: 'ashflat',
    level: 2,
    text: 'The kids on the platform bet on which train will not come. Sit with them a while, then ask the Courier if one ever did.',
    doing: 'The platform is in the Old Rail Yard, south of the avenue. The Courier is by the east end.',
    thanks: 'None ever did. That is why the bet is safe.',
    stars: 1,
    objectives: [O('reach', 1, { target: 'a-last' }), O('talk', 1, { target: 'a-courier' })],
    reward: { wav: 100 },
  },
  {
    id: 's-a-scrap',
    name: 'Static for Cards',
    giver: 'a-scrapper',
    kind: 'side',
    sector: 'ashflat',
    text: 'I buy static and sell cards. Go to the Card Shop, sell one of yours and show me you can trade — I do not deal with people who just hoard.',
    doing: 'Card Shop, Market Row. Sell a card across the counter.',
    thanks: 'A trader. Now we can do business.',
    stars: 1,
    objectives: [O('enter', 1, { target: 'shop' }), O('sellCard', 1)],
    reward: { wav: 90, items: { scan: 1 } },
  },
  {
    id: 's-a-elder',
    name: 'When the Wave Was Quiet',
    giver: 'a-elder',
    kind: 'side',
    sector: 'ashflat',
    level: 2,
    text: 'Before I am gone I want to know what two places look like now: the shrine in the Scrap Lot, and the Old Clock in the Square. Go. Tell me what changed.',
    doing: 'The Scrap Shrine is behind the Scrap Lot, south-east. The Old Clock is in Clock Square.',
    thanks: 'Everything changed, and nothing did. Thank you, child.',
    stars: 1,
    objectives: [O('reach', 1, { target: 'a-shrine' }), O('reach', 1, { target: 'a-oldclock' })],
    reward: { wav: 110 },
  },
  {
    id: 's-a-hertz',
    name: 'Mr. Hertz',
    giver: 'a-elder',
    kind: 'side',
    sector: 'ashflat',
    level: 2,
    after: 's-a-elder',
    text: 'There is a man only the Visualizer shows: Mr. Hertz. He stands by the wall in the Scrap Lot. Put the Visualizer on and say hello. He knows things nobody else will say out loud.',
    doing: 'Press V. Mr. Hertz is by the wall at the back of the Scrap Lot.',
    thanks: 'He spoke to you? He has not spoken to anyone in years.',
    stars: 2,
    objectives: [O('talk', 1, { target: 'a-hertz' })],
    reward: { wav: 130, items: { pack: 2 } },
  },
  {
    id: 's-a-courier',
    name: 'Special Delivery',
    giver: 'a-courier',
    turnIn: 'a-watchman',
    kind: 'side',
    sector: 'ashflat',
    level: 2,
    text: 'I have a packet for the Watchman at the Fold Gate. Hand it over in person. Do not open it. I mean it.',
    doing: 'The Watchman minds the Fold Gate at the east end of the main street.',
    thanks: 'Sealed? Good. You are not as curious as you look.',
    stars: 1,
    objectives: [O('talk', 1, { target: 'a-watchman' })],
    reward: { wav: 100 },
  },
  {
    id: 's-a-chat',
    name: 'Say Hello',
    giver: 'a-noodle',
    kind: 'side',
    sector: 'ashflat',
    text: 'Nobody talks any more, they just stare at the tape. Say hello to the street. Press Enter, type something, send it. It counts.',
    doing: 'Press Enter to open the chat line.',
    thanks: 'I heard that all the way over here. Nice.',
    stars: 1,
    objectives: [O('chat', 2)],
    reward: { wav: 50 },
  },
  {
    id: 's-a-storm',
    name: 'Colours Count',
    giver: 'a-scribe',
    kind: 'side',
    sector: 'ashflat',
    level: 3,
    after: 'm-04',
    text: 'When an anomaly is open, the Wave Station will light up. Pulse in and take one down for your colours. Points banked on the war ledger are points that stay.',
    doing: 'Wait for the beam over the Wave Station to turn amber or red, then pulse in.',
    thanks: 'Counted and ledgered. The week is long yet.',
    stars: 2,
    objectives: [O('clear', 1)],
    reward: { wav: 160 },
  },
];

export const ALL_QUESTS: readonly QuestDef[] = [...STORY, ...SIDE];
export const QUESTS: ReadonlyMap<string, QuestDef> = new Map(ALL_QUESTS.map((q) => [q.id, q]));

/** Whom a quest is handed back to. */
export const turnInOf = (q: QuestDef): string => q.turnIn ?? q.giver;

/** A quest the player could take today: never accepted, prerequisites met, level high enough. */
export function isOpen(q: QuestDef, log: QuestLog, level: number): boolean {
  if (log[q.id]) return false;
  if (q.after && !log[q.after]?.turnedIn) return false;
  return level >= (q.level ?? 1);
}

export function offersFor(npcId: string, log: QuestLog, level: number): QuestDef[] {
  return ALL_QUESTS.filter((q) => q.giver === npcId && isOpen(q, log, level));
}

/** Quests the player has finished and this person is waiting to hear about. */
export function readyAt(npcId: string, log: QuestLog, defs: readonly QuestDef[] = ALL_QUESTS): QuestDef[] {
  return defs.filter((q) => {
    const st = log[q.id];
    return !!st && st.done && !st.turnedIn && turnInOf(q) === npcId;
  });
}

/** Quests the player has taken from, or must report to, this person and not yet finished. */
export function pendingAt(npcId: string, log: QuestLog, defs: readonly QuestDef[] = ALL_QUESTS): QuestDef[] {
  return defs.filter((q) => {
    const st = log[q.id];
    return !!st && !st.done && !st.turnedIn && (q.giver === npcId || turnInOf(q) === npcId);
  });
}

export type Mark = 'offer' | 'turnin' | 'progress';

/**
 * The marker over each person's head: a gold ! for a quest on offer, a green ? for one
 * ready to hand in, a grey … while the player is mid-errand with them. Turn-in wins over
 * offer, because the thing worth walking to first is a reward.
 */
export function marksFor(log: QuestLog, level: number, extra: readonly QuestDef[] = []): Record<string, Mark> {
  const out: Record<string, Mark> = {};
  const defs = [...ALL_QUESTS, ...extra];
  for (const q of defs) {
    const st = log[q.id];
    if (st && !st.turnedIn) {
      if (st.done) out[turnInOf(q)] = 'turnin';
      else {
        for (const id of new Set([q.giver, turnInOf(q)])) if (out[id] !== 'turnin' && out[id] !== 'offer') out[id] = 'progress';
      }
    }
  }
  for (const q of defs) {
    if (!isOpen(q, log, level)) continue;
    if (out[q.giver] !== 'turnin') out[q.giver] = 'offer';
  }
  return out;
}

/** Where each open objective of each active quest points: a person, a place or a door. */
export function trackTargets(log: QuestLog, defs: readonly QuestDef[] = ALL_QUESTS): { quest: string; kind: 'npc' | 'poi' | 'door'; id: string }[] {
  const out: { quest: string; kind: 'npc' | 'poi' | 'door'; id: string }[] = [];
  for (const q of defs) {
    const st = log[q.id];
    if (!st || st.turnedIn) continue;
    if (st.done) {
      out.push({ quest: q.id, kind: 'npc', id: turnInOf(q) });
      continue;
    }
    q.objectives.forEach((o, i) => {
      if ((st.progress[i] ?? 0) >= o.need) return;
      if (o.kind === 'dungeonClear') out.push({ quest: q.id, kind: 'door', id: 'dungeon' });
      else if (!o.target) return;
      else if (o.kind === 'talk') out.push({ quest: q.id, kind: 'npc', id: o.target });
      else if (o.kind === 'reach') out.push({ quest: q.id, kind: 'poi', id: o.target });
      else if (o.kind === 'enter') out.push({ quest: q.id, kind: 'door', id: o.target });
    });
  }
  return out;
}
