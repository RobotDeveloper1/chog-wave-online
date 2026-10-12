import type { SectorId } from './wave.ts';
import type { Attr, Vector } from './formula.ts';

export type Element = 'burn' | 'frost' | 'volt' | 'wave' | 'prism' | 'void';

export type EyeStyle = 'laser' | 'visor' | 'vr' | 'wide' | 'narrow' | 'tear' | 'dead' | 'wild';
export type FolderProfile = 'standard' | 'balanced' | 'mega' | 'giga' | 'chaos';
export type GearMod = 'gauge' | 'hp' | 'slots' | 'crit' | 'guard' | 'drain' | 'speed';
export type FormRule = 'none' | 'undeath' | 'poison' | 'pristine';

/** Mouth is the voice: it bends one combat number rather than granting a card. */
export interface VoiceMod {
  gaugePct?: number;
  critPct?: number;
  drainPct?: number;
  /** Negative makes the Chog sneakier, positive pulls aggro. */
  aggro?: number;
}

/** Everything the 13 trait categories decide about how a Chog fights. */
export interface ChogLoadout {
  element: Element;
  /** Which category supplied the tribe, since Aura covers only half the collection. */
  elementSource: string;
  weakness: Element;
  style: EyeStyle;
  /** The card this Chog is born holding, from its Accessory. */
  signature: string | null;
  profile: FolderProfile;
  gear: GearMod;
  voice: VoiceMod;
  resist: Element | null;
  nativeSector: SectorId;
  formRule: FormRule;
  /** Which custom-grid column starts unlocked, from the Side trait. */
  stance: 'left' | 'right';
  naked: boolean;
  megaCap: number;
  gigaCap: number;
  /** Human-readable one-liners, so the inspect panel can explain itself. */
  why: string[];
}

/**
 * Every Chog Genesis shares the same mane silhouette — only the colour changes
 * with Skin. Both the Blender generator and the client's habitat dots read this,
 * so a dot and its model cannot drift apart.
 */
export const MANE_SPIKES = 12;

/** Occupied cells as [row, col] offsets from the placement anchor. */
export type CellShape = ReadonlyArray<readonly [number, number]>;

export interface Chip {
  id: string;
  name: string;
  element: Element;
  shape: CellShape;
  /** Raw damage per hit before grid bonuses. */
  power: number;
  hits: number;
  effect: 'pierce' | 'stun' | 'drain' | 'knock' | 'chain' | 'none';
  /** Fraction of the sector Wave Index this chip bleeds off on hit. */
  waveDrain: number;
  /** Star Force rarity class. Folder rules cap Mega and Giga copies. */
  klass?: 'S' | 'M' | 'G';
  /** Which trait granted this card at birth — exactly one of these is set. */
  signature?: string;
  voice?: string;
  style?: string;
  base?: string;
}

export interface Placement {
  chipId: string;
  row: number;
  col: number;
}

export interface GridScore {
  damage: number;
  hits: number;
  effects: Chip['effect'][];
  /** Same-element neighbours found on the grid. */
  resonance: Partial<Record<Element, number>>;
  fillRatio: number;
  /** Multiplier from resonance + fill, already applied to damage. */
  multiplier: number;
  waveDrain: number;
}

export interface SaveView {
  tokenId: number;
  kills: number;
  stormKills: number;
  chips: string[];
  peakWave: number;
  streak: number;
  season: string;
  updatedAt: number;
}

export interface ChogSource {
  tokenId: number;
  /** Number of `Transfer` events this token has ever produced. */
  transferCount: number;
  /** Days the current holder has held it. */
  daysHeld: number;
  mintBlock?: number;
  /** Absent when the collection ships image-only metadata. */
  attributes?: Record<string, string>;
}

export interface Personality {
  aggression: number;
  skittish: number;
  curiosity: number;
  stamina: number;
}

export interface ChogBuild {
  tokenId: number;
  callsign: string;
  personality: Personality;
  /** 0..1 — damage dealt to Anomalies *and* aggro pulled toward self. */
  waveAffinity: number;
  /** 0..1 — stealth + crit. Rises with days held, capped by waveAffinity forever. */
  cleanSignal: number;
  /** The hard cap provenance places on cleanSignal, so the panel can say why. */
  cleanCeiling: number;
  /** The six budget-filled attributes from the formula. */
  attrs: Vector;
  damageBonus: number;
  aggroRadius: number;
  crit: number;
  /** Recomputable proof of how this build was derived. */
  audit: string;
  /** Grid edge length, 3..5. */
  linkSlots: number;
  /** Every distinct card this Chog was born able to field. */
  library: string[];
  /**
   * The folder this Chog was born with, *with its repeats*. The Custom Screen draws from
   * a folder, not a library: five copies of one card make it five times as likely, which is
   * the whole point of the Body trait's copy limit. `library` is this, de-duplicated.
   */
  folder: string[];
  signature: string;
  hasTraits: boolean;
  /** The full trait reading, so the client can explain a build without redoing it. */
  loadout: ChogLoadout;
}
