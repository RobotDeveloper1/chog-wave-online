import type { ChogLoadout, Element, EyeStyle, FolderProfile, FormRule, GearMod, VoiceMod } from './types.ts';
import type { SectorId } from './wave.ts';
import {
  CHIP_BY_BASE,
  CHIP_BY_EYES_STYLE,
  CHIP_BY_MOUTH,
  CHIP_BY_SIGNATURE,
} from './chips.ts';

/**
 * Every trait value in Chog Genesis resolves to something the player can feel in
 * combat. This file is the whole "why is the NFT essential" argument: remove the
 * token and there is no element, no attack style, no held card, no folder shape.
 *
 * Tables are written outcome-first (a list of values per outcome) rather than as
 * 272 `value: outcome` lines. Same coverage, but a missing or doubled value is
 * visible, and anomaly.test.ts fails the build if the scraped metadata ever
 * contains a value that is not listed here.
 */

/** What beats what. A 4-cycle plus one mutually hostile pair. */
export const WEAK_TO: Record<Element, Element> = {
  burn: 'wave',
  wave: 'volt',
  volt: 'frost',
  frost: 'burn',
  prism: 'void',
  void: 'prism',
};

export function matchup(attacker: Element, defender: Element): number {
  if (attacker === defender) return 1;
  if (WEAK_TO[defender] === attacker) return 2;
  if (WEAK_TO[attacker] === defender) return 0.5;
  return 1;
}

function invert<T extends string>(byOutcome: Record<T, readonly string[]>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const outcome of Object.keys(byOutcome) as T[]) {
    for (const value of byOutcome[outcome]) {
      const key = value.trim().toLowerCase();
      if (key in out) throw new Error(`trait value listed twice: ${value}`);
      out[key] = outcome;
    }
  }
  return out;
}

const AURA_ELEMENT = invert<Element>({
  burn: ['Burning Aura', 'Fiery Aura', 'Fire'],
  frost: ['Royal Blue Aura', 'Mint', 'Cool Aura'],
  wave: ['Rose Aura', 'Aqua Aura', 'Rose Scent', 'Pink Mist'],
  volt: ['Electric Shock', 'Yellow Aura'],
  prism: ['Wind', 'Royal Aura', 'Clean', 'Light Purple'],
  void: ['Purple', 'Violet', 'Smoke', 'Green Aura'],
});

const BACKGROUND_SECTOR = invert<SectorId>({
  ashflat: ['Coral Pink', 'Lemon', 'Rosie', 'Sunlight', 'Lemon Yellow', 'Peach Pink', 'Afternoon Orange', 'Rosy Pink'],
  voltgrid: ['Mon', 'Light Purple', 'Light Magenta', 'Soft Lavender', 'Radioactive'],
  hollow: ['Aqua', 'Mint', 'Sky Blue', 'Aqua Mint', 'Fresh Green', 'Lime Green', 'Deep Aqua', 'Deep Blue'],
});

const EYES_STYLE = invert<EyeStyle>({
  laser: ['Purple laser', 'fire laser', 'Green laser', 'cyan laser', 'Chog Viper'],
  visor: ['Sunset visor', 'Gradient visor', 'Plasma visor', 'Retro Glass', 'Anime Glass', 'BTC Glass', '3D Glass'],
  vr: ['Modern VR', 'Classic VR'],
  wide: ['Happy', 'Normal Eye', 'Round', 'Round Eye', 'XD', 'Up', 'Base', 'Round Crying'],
  narrow: ['Side Eye', 'Vertical', 'Flat', 'Green Side Eye', 'Blue Flat', 'Red Round Eye'],
  tear: ['Closed Eye Crying', 'Teary', 'Round Tear', 'Worried', 'Tired'],
  dead: ['Dead'],
  wild: ['Heart', 'Clown Eye Mix', 'Clown Eye', 'MOG', 'Retard', 'Blue Retard', 'Frog', 'Thug', 'Smirk', 'Angry'],
});

const BODY_PROFILE = invert<FolderProfile>({
  giga: ['Kings Robe', 'Golden Armor', 'Dragon suit', 'Wizard', 'Jesus', 'Astro Suit', 'Zero THOTS', 'Gojo', 'CEO Vest'],
  mega: [
    'Gangster suit', 'Tuxedo', 'Red Tuxedo', 'Cream Tuxedo', 'Pink Tuxedo', 'White tuxedo', 'Cyan tuxedo',
    'Blue tuxedo', 'Aqua Tuxedo', 'Squid Game Guard', 'Squid Game', 'Inmate', 'Prisoner', 'CWO', 'Army Vest',
    'Shark Suit', 'Sci Fi', 'Electro Hoodie', 'Glitch Hoodie', 'Blue Chinese', 'Red Chinese', 'Red jacket',
    'Blue jacket', 'dark jacket', 'Toad blue suit', 'Toad pink suit', 'Toad green Suit',
  ],
  chaos: [
    'Banana suit', 'Duck Float', 'MILF Lover', 'Six Seven', 'BBC', 'Guko', 'Boner', 'Chug Life', 'Hawaiian Polo',
    'Stripes', 'Stripe shirts', 'Brown Homeless Shirt', 'Grey Homeless Shirt', 'Blue Homeless Shirt',
    'Blue Holed Jacket',
  ],
  balanced: [
    'Black Trackset', 'Red Trackset', 'Yellow Hoodie', 'Orange Hoodie', 'Peach Hoodie', 'Sky Hoodie', 'Mon Hoodie',
    'Yellow Yukata', 'White Yukata', 'Yellow 143 Jersey', 'Red 143 Jersey', 'Blue 143 Jersey', 'Farmer Shirt',
    'Tank Top', 'Red Sleeveless', 'Orange Sleeveless', 'White Sleeveless',
  ],
  standard: [
    'Black Shirt', 'White Pure Shirt', 'Yellow Shirt', 'Grey Shirt', 'White Shirt', 'Red shirt',
    'Pink Shirt', 'Purple Shirt', 'Black Vest', 'dark vest', 'pink vest', 'dark tee', 'red tee', 'purple vest',
    'Fire Shirt', 'Virgin',
  ],
});

const HEAD_GEAR = invert<GearMod>({
  gauge: ['Thunder Cap', '10k TPS Cap', 'WAGMI Cap', 'MMGA Cap', 'MCGA', 'MCGA Cap', 'MEGA Chog', 'Choggie Cap', 'Chog Cap', 'Star Cap', 'Cloud Cap', 'Rainbow Wig'],
  hp: ['Spartan Helmet', 'Russian Hat', 'Gold Thorn', 'Silver Thorn', 'Crown', 'Holy Seal', 'Purple Horn', 'Plumber', 'Robber'],
  slots: ['Wizard Hat', 'Wizard Beanie', '3rd Eye', 'Durag', 'Bob Hair', 'Head Wrap', 'NEET', 'JEET Cap'],
  crit: ['Red Headband', 'Japan Headband', 'RETARD Cap', 'Boob Cap', 'Horny Cap', 'Clown Nose', 'Balls Cap'],
  guard: ['Mon Cap', 'Mon Beanie', 'Choggie Beanie', 'RH Beanie', 'BTC Beanie', 'BTC Cap', 'Dollar Cap', 'Buttcoin Cap', 'ETH Cap'],
  drain: ['TISM Cap', 'Peace hat', 'Red Peace Cap'],
  speed: ['Gray Bucket Cap', 'Orange Bucket Cap', 'Blue Bucket Cap'],
});

const MOUTH_VOICE: Record<string, VoiceMod> = {
  'normal smile': { aggro: 0.1 },
  smile: { aggro: 0.15, gaugePct: 5 },
  sad: { drainPct: 10 },
  worried: { critPct: 8, aggro: -0.1 },
  flat: { gaugePct: 8 },
  wo: { gaugePct: -8, critPct: 15 },
  bubblegum: { aggro: 0.25, drainPct: 5 },
  drooling: { drainPct: 15 },
  'rainbow puke': { aggro: 0.35, drainPct: 20, gaugePct: -10 },
  'lip bite': { critPct: 18, aggro: -0.15 },
  'gold tooth': { aggro: 0.2 },
  'btc coin': { critPct: 10 },
  'mon coin': { gaugePct: 10 },
  grit: { aggro: 0.3, drainPct: -10 },
  'clown mouth': { aggro: 0.4, gaugePct: -5, critPct: 12 },
};

const SKIN_RESIST = invert<Element>({
  burn: ['Red'],
  frost: ['Green', 'Jade'],
  volt: ['Yellow', 'Metal'],
  wave: ['Blue'],
  prism: ['White', 'Grey', 'Pink', 'Origin'],
  void: ['Black', 'Purple'],
});

const BASE_FORM = invert<FormRule>({
  none: ['Origin', 'Chog', '1:1'],
  undeath: ['Skull'],
  poison: ['Radioactive'],
  pristine: ['Naked'],
});

const TIER_CAP: Record<string, { mega: number; giga: number }> = {
  common: { mega: 1, giga: 0 },
  uncommon: { mega: 2, giga: 0 },
  rare: { mega: 3, giga: 1 },
  epic: { mega: 4, giga: 1 },
  legendary: { mega: 5, giga: 2 },
};

const FALLBACK_ELEMENT: Element = 'prism';
const FALLBACK_STYLE: EyeStyle = 'wide';
const FALLBACK_PROFILE: FolderProfile = 'standard';
const FALLBACK_GEAR: GearMod = 'gauge';
const FALLBACK_SECTOR: SectorId = 'hollow';

const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();

/**
 * Only half the collection carries an Aura, so the tribe cannot come from that one
 * category or the other half all silently collapse onto the fallback element. The
 * cascade reads the first source that is actually present: the skin's resist *is*
 * the element the Chog embodies, the background is the field it stands in, and the
 * base is what it fundamentally is. tokenId only breaks a tie nobody else could see.
 */
const BACKGROUND_ELEMENT = invert<Element>({
  burn: ['Coral Pink', 'Lemon', 'Sunlight', 'Afternoon Orange', 'Rosy Pink', 'Peach Pink', 'Lemon Yellow', 'Rosie'],
  frost: ['Deep Blue', 'Sky Blue', 'Deep Aqua', 'Mint', 'Aqua Mint'],
  volt: ['Mon', 'Radioactive', 'Fresh Green', 'Lime Green'],
  wave: ['Aqua', 'Soft Lavender'],
  prism: ['Light Purple', 'Light Magenta'],
  void: [],
});

const BASE_ELEMENT = invert<Element>({
  burn: ['Origin'],
  frost: ['Skull'],
  volt: ['Radioactive'],
  wave: ['1:1'],
  prism: [],
  void: [],
});

function elementFrom(a: Record<string, string>): { element: Element; source: string } {
  const aura = AURA_ELEMENT[norm(a.Aura)];
  if (aura) return { element: aura, source: 'Aura' };
  const skin = SKIN_RESIST[norm(a.Skin)];
  if (skin) return { element: skin, source: 'Skin' };
  const bg = BACKGROUND_ELEMENT[norm(a.Background)];
  if (bg) return { element: bg, source: 'Background' };
  const base = BASE_ELEMENT[norm(a.Base)];
  if (base) return { element: base, source: 'Base' };
  return { element: FALLBACK_ELEMENT, source: 'tokenId' };
}

/**
 * Unknown values fall back rather than throwing: metadata is scraped from a live
 * chain and a new trait value must not brick a player's character. The coverage
 * test is what keeps the fallbacks from silently hiding a gap.
 */
export function loadoutOf(attributes: Record<string, string> | undefined): ChogLoadout {
  const a = attributes ?? {};
  const { element, source: elementSource } = elementFrom(a);
  const style = EYES_STYLE[norm(a.Eyes)] ?? FALLBACK_STYLE;
  const profile = BODY_PROFILE[norm(a.Body)] ?? FALLBACK_PROFILE;
  const gear = HEAD_GEAR[norm(a.Head)] ?? FALLBACK_GEAR;
  const sector = BACKGROUND_SECTOR[norm(a.Background)] ?? FALLBACK_SECTOR;
  const skin = SKIN_RESIST[norm(a.Skin)] ?? null;
  const form = BASE_FORM[norm(a.Base)] ?? BASE_FORM[norm(a.Form)] ?? 'none';
  const tier = TIER_CAP[norm(a.Tier)] ?? TIER_CAP.common!;
  // A held card is the clearest "this Chog owns something you do not", and it has
  // to exist for everyone: Accessory covers only 9% of the collection, so the
  // voice and the lock-on style carry it for the rest.
  const sigChip =
    CHIP_BY_SIGNATURE.get((a.Accessory ?? '').trim()) ??
    CHIP_BY_MOUTH.get(norm(a.Mouth)) ??
    CHIP_BY_EYES_STYLE.get(EYES_STYLE[norm(a.Eyes)] ?? '') ??
    CHIP_BY_BASE.get(norm(a.Base)) ??
    null;

  const why: string[] = [];
  why.push(`${elementSource} → tribe ${element}`);
  if (sigChip) why.push(`holds ${sigChip.name}`);
  if (attributes?.Eyes) why.push(`Eyes ${a.Eyes} → ${style} lock-on`);
  if (sigChip) why.push(`holds ${sigChip.name}`);
  if (attributes?.Body) why.push(`${a.Body} → ${profile} folder`);
  if (form !== 'none') why.push(`${a.Base ?? a.Form}: ${form}`);

  return {
    element,
    weakness: WEAK_TO[element],
    style,
    signature: sigChip?.id ?? null,
    profile,
    gear,
    voice: MOUTH_VOICE[norm(a.Mouth)] ?? {},
    resist: skin,
    nativeSector: sector,
    elementSource,
    formRule: form,
    stance: norm(a.Side) === 'left' ? 'left' : 'right',
    naked: norm(a.Naked) === 'yes',
    megaCap: tier.mega,
    gigaCap: tier.giga,
    why,
  };
}

/** How many of each rarity class the folder may hold, from the Body profile. */
export function folderShape(profile: FolderProfile): { size: number; copies: number } {
  switch (profile) {
    case 'standard':
      return { size: 30, copies: 5 };
    case 'balanced':
      return { size: 30, copies: 4 };
    case 'mega':
      return { size: 32, copies: 3 };
    case 'giga':
      return { size: 34, copies: 2 };
    case 'chaos':
      return { size: 30, copies: 3 };
  }
}

/**
 * The formula's family keys for one trait reading, in the order the affinity
 * tables expect. Derived here so the build formula and its tests cannot drift
 * apart from the trait tables by re-deriving the keys separately.
 */
export function affinityKeys(loadout: ChogLoadout, attributes: Record<string, string> | undefined): string[] {
  const a = attributes ?? {};
  const accessory = (a.Accessory ?? '').trim();
  return [
    loadout.element,
    loadout.style,
    `g_${loadout.gear}`,
    `f_${loadout.profile}`,
    `r_${loadout.resist ?? 'prism'}`,
    accessory ? `h_${ACCESSORY_FAMILY.get(accessory.toLowerCase()) ?? 'none'}` : 'h_none',
    `s_${loadout.nativeSector}`,
    `x_${loadout.formRule}`,
    'stance',
  ];
}

const ACCESSORY_FAMILY = new Map(
  Object.entries({
    Fwog: 'fwog',
    Knife: 'knife',
    Coin: 'coin',
    Heart: 'heart',
    'Green Candle': 'green_candle',
    'Red Candle': 'red_candle',
    Cigar: 'cigar',
    SB: 'sb',
    PEPE: 'pepe',
  }).map(([k, v]) => [k.toLowerCase(), v] as const),
);

export const TRAIT_TABLES = {
  Aura: AURA_ELEMENT,
  Background: BACKGROUND_SECTOR,
  Eyes: EYES_STYLE,
  Body: BODY_PROFILE,
  Head: HEAD_GEAR,
  Skin: SKIN_RESIST,
  Base: BASE_FORM,
  Form: BASE_FORM,
  Mouth: Object.keys(MOUTH_VOICE).reduce<Record<string, string>>((acc, k) => {
    acc[k] = 'voice';
    return acc;
  }, {}),
  Accessory: Object.fromEntries([...CHIP_BY_SIGNATURE].map(([k, v]) => [k.toLowerCase(), v.id])),
  Tier: Object.fromEntries(Object.keys(TIER_CAP).map((k) => [k, 'cap'])),
  Side: { right: 'right', left: 'left' } as Record<string, string>,
  Naked: { no: 'no', yes: 'yes' } as Record<string, string>,
};
