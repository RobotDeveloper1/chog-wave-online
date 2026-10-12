/**
 * Mobs that inhabit each dungeon. Every node fight rolls from the dungeon's
 * roster, with a chance of a band (2-3 mobs) depending on node kind and tier.
 *
 * A mob has a name, an element, a tier (min..max), and a body count: how many
 * copies appear when it is rolled as part of a band. The strongest mob in a
 * band is the "lead" and the rest are "minions".
 */

export interface MobDef {
  id: string;
  name: string;
  element: string;
  tierMin: number;
  tierMax: number;
  /** How many copies of this mob appear in a band (usually 1). */
  copies: number;
  /** Whether this mob can be the lead of a band. */
  canLead: boolean;
}

export interface MobBand {
  lead: MobDef;
  minions: MobDef[];
}

const MOBS: Record<string, MobDef[]> = {
  'd-ember': [
    { id: 'ember_slug', name: 'SLAG SLUG', element: 'burn', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'ember_golem', name: 'CINDER GOLEM', element: 'burn', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'ember_ash', name: 'ASH WRAITH', element: 'burn', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'ember_maw', name: 'MAW OF FORGE', element: 'burn', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'ember_spark', name: 'FORGE SPARK', element: 'burn', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
  'd-frost': [
    { id: 'frost_shard', name: 'ICE SHARD', element: 'frost', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'frost_wolf', name: 'GLACIER WOLF', element: 'frost', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'frost_lich', name: 'FROZEN LICH', element: 'frost', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'frost_titan', name: 'TITAN OF RIME', element: 'frost', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'frost_snow', name: 'SNOW SWARM', element: 'frost', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
  'd-volt': [
    { id: 'volt_spark', name: 'STATIC SPARK', element: 'volt', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'volt_stalker', name: 'COIL STALKER', element: 'volt', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'volt_wraith', name: 'LIVE WRAITH', element: 'volt', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'volt_tower', name: 'RELAY TOWER', element: 'volt', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'volt_arc', name: 'ARC SWARM', element: 'volt', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
  'd-wave': [
    { id: 'wave_drip', name: 'DRIPLING', element: 'wave', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'wave_shark', name: 'DEEP SHARK', element: 'wave', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'wave_kraken', name: 'TIDE KRAKEN', element: 'wave', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'wave_levi', name: 'LEVIATHAN', element: 'wave', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'wave_bubble', name: 'BUBBLE SWARM', element: 'wave', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
  'd-prism': [
    { id: 'prism_dust', name: 'DUST MOTE', element: 'prism', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'prism_knight', name: 'REFRACTION KNIGHT', element: 'prism', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'prism_eye', name: 'PRISM EYE', element: 'prism', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'prism_core', name: 'CORE OF LIGHT', element: 'prism', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'prism_shard', name: 'SHARD SWARM', element: 'prism', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
  'd-void': [
    { id: 'void_wisp', name: 'NULL WISP', element: 'void', tierMin: 1, tierMax: 4, copies: 2, canLead: false },
    { id: 'void_hunter', name: 'RIFT HUNTER', element: 'void', tierMin: 2, tierMax: 5, copies: 1, canLead: true },
    { id: 'void_lich', name: 'UNMADE LICH', element: 'void', tierMin: 3, tierMax: 6, copies: 1, canLead: true },
    { id: 'void_maw', name: 'MAW OF NULL', element: 'void', tierMin: 4, tierMax: 7, copies: 1, canLead: true },
    { id: 'void_echo', name: 'ECHO SWARM', element: 'void', tierMin: 1, tierMax: 3, copies: 3, canLead: false },
  ],
};

export function mobsFor(dungeonId: string): MobDef[] {
  return MOBS[dungeonId] ?? MOBS['d-void']!;
}

/** Roll a band for a node. Returns 1 lead + 0-2 minions. */
export function rollBand(dungeonId: string, nodeKind: string, tier: number, seed: number): MobBand {
  const pool = mobsFor(dungeonId);
  const leads = pool.filter((m) => m.canLead && tier >= m.tierMin && tier <= m.tierMax);
  const minionPool = pool.filter((m) => !m.canLead && tier >= m.tierMin && tier <= m.tierMax);
  const lead = leads[seed % leads.length] ?? leads[0] ?? pool[0]!;

  let minionCount = 0;
  if (nodeKind === 'wave') minionCount = (seed % 3 === 0) ? 2 : 1;       // 1-2 minions
  else if (nodeKind === 'elite') minionCount = (seed % 4 === 0) ? 1 : 0; // sometimes 1 minion
  else if (nodeKind === 'boss') minionCount = 2;                         // boss always has 2 guards
  else minionCount = 0;

  const minions: MobDef[] = [];
  for (let i = 0; i < minionCount && minionPool.length > 0; i++) {
    const m = minionPool[(seed + i * 7) % minionPool.length];
    if (!m) continue;
    for (let c = 0; c < m.copies; c++) minions.push(m);
  }
  return { lead, minions };
}
