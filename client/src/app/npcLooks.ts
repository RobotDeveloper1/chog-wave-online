/**
 * What the city's people wear.
 *
 * Every NPC dresses from this table — no hash, no pool lottery. Each look is
 * picked for the role: the nurse reads as relief, the dealer as a risk, the
 * wanderer as a warning. Shared by the street (`explorer.npcTraits`) and the
 * lineup page (`npcPreview`), so the two can never disagree about a face.
 *
 * Keys must be exact pool names from `trait-parts.json` / `skins.json`.
 */

export type TraitSet = Record<string, string>;

/** Curated looks, by NPC id. */
export const NPC_LOOKS: Record<string, TraitSet> = {
  // ---------------------------------------------------------------- ashflat
  // DEALER 143: the floor in a jersey. Shady, gold-toothed, always selling.
  'a-dealer': { Skin: 'Beige', Body: 'Yellow 143 Jersey', Head: 'Dollar Cap', Eyes: 'Green Smirk', Mouth: 'Gold Tooth' },
  // NURSE HOLLOW: clean whites, a halo, a smile. A healer reads as relief.
  'a-nurse': { Skin: 'White', Body: 'White Pure Shirt', Head: 'Holy Seal', Eyes: 'Blue Happy', Mouth: 'Smile' },
  // OPERATOR: the station's voice. Grey, visored, all business.
  'a-operator': { Skin: 'Grey', Body: 'Sci Fi', Head: 'Chog Cap', Eyes: 'Modern VR', Mouth: 'Flat' },
  // SCRIBE: writes the war down. Tired eyes, gritted teeth.
  'a-scribe': { Skin: 'Beige', Body: 'Stripe Shirt', Head: 'Japan Headband', Eyes: 'Tired', Mouth: 'Grit' },
  // ARCHIVIST: keeper of the album. Robed, glassed, unreadable.
  'a-archivist': { Skin: 'Grey', Body: 'dark jacket', Head: 'Wizard Hat', Eyes: 'Retro Glass', Mouth: 'Flat' },
  // WATCHMAN: the fold's guard. Armoured tracksuit, furious stare.
  'a-watchman': { Skin: 'Blue', Body: 'Squid Game Guard', Head: 'Red Headband', Eyes: 'Angry', Mouth: 'Grit' },
  // BAKER MIRA: bread first. Warm whites and a genuine smile.
  'a-baker': { Skin: 'Beige', Body: 'White Shirt', Head: 'Bob Hair', Eyes: 'Happy', Mouth: 'Smile' },
  // NOODLE COOK: two bowls, one rumour. Bandana, smirk, chinese shirt.
  'a-noodle': { Skin: 'Yellow', Body: 'Blue Chinese', Head: 'Red Bandana', Eyes: 'Smirk', Mouth: 'normal smile' },
  // CLOCKKEEPER: it has not been right since the Index started. Metal and worry.
  'a-clock': { Skin: 'Metal', Body: 'CEO Vest', Head: 'Mon Beanie', Eyes: 'Retro Glass', Mouth: 'Worried' },
  // ELDER SPARK: remembers the quiet wave. Robed, round-eyed, kind.
  'a-elder': { Skin: 'Grey', Body: 'Kings Robe', Head: 'Russian Hat', Eyes: 'Round', Mouth: 'normal smile' },
  // GARDENER: nothing grows in a storm. Green thumbs, bucket cap, happy.
  'a-gardener': { Skin: 'Green', Body: 'Farmer Shirt', Head: 'Blue Bucket Cap', Eyes: 'Happy', Mouth: 'Smile' },
  // OLD FISHER: the moat keeps what the street loses. Weathered and holed.
  'a-fisher': { Skin: 'Beige', Body: 'Blue Holed Jacket', Head: 'Gray Bucket Cap', Eyes: 'Tired', Mouth: 'Grit' },
  // RAIL ENGINEER: last train left before the Index. Orange jacket, thunder cap.
  'a-engineer': { Skin: 'Beige', Body: 'Orange Holed Jacket', Head: 'Thunder Cap', Eyes: 'Anime Glass', Mouth: 'Flat' },
  // SCRAPPER: one man's static. Lurker in a robber mask, biting its lip.
  'a-scrapper': { Skin: 'Jade', Body: 'dark tee', Head: 'Robber', Eyes: 'Green Smirk', Mouth: 'Lip Bite' },
  // MR. HERTZ: you can see him. Do not tell the others. Same look, every district.
  'a-hertz': { Skin: 'Multi Colored', Body: 'Glitch Hoodie', Head: '3rd Eye', Eyes: 'Purple laser', Mouth: 'wo' },
  // COURIER: the Index delivers everything, eventually. Trackset, star cap, up-eyes.
  'a-courier': { Skin: 'Blue', Body: 'Red Trackset', Head: 'Star Cap', Eyes: 'Up', Mouth: 'Smile' },
  // ---------------------------------------------------------------- voltgrid
  // KIOSK 7: every card fell off a server. Metal, electro, BTC through and through.
  'v-dealer': { Skin: 'Metal', Body: 'Electro Hoodie', Head: 'BTC Cap', Eyes: 'BTC Glass', Mouth: 'Lip Bite' },
  // TECH MEDIC: your integrity is a rumour. Clinical white sci-fi, flat affect.
  'v-nurse': { Skin: 'White', Body: 'Sci Fi', Head: 'Blue Laser', Eyes: 'Blue Flat', Mouth: 'Flat' },
  // RELAY OPERATOR: the index never drops below the floor here. Cap, plasma visor.
  'v-operator': { Skin: 'Grey', Body: 'CWO', Head: 'Choggie Cap', Eyes: 'Plasma visor', Mouth: 'Flat' },
  // EXCHANGE CLERK: volume is the only honest number. Red shirt, dollar cap, gold tooth.
  'v-scribe': { Skin: 'Beige', Body: 'Red shirt', Head: 'Dollar Cap', Eyes: 'Green Round Eye', Mouth: 'Gold Tooth' },
  // CORE ARCHIVE: the tower remembers. Black jacket, mascot head, red laser stare.
  'v-archivist': { Skin: 'Black', Body: 'dark jacket', Head: 'MEGA Chog', Eyes: 'Red laser', Mouth: 'Flat' },
  // GATE WARDEN: the fold is deeper here. Golden armour, spartan helm, angry.
  'v-watchman': { Skin: 'Blue', Body: 'Golden Armor', Head: 'Spartan Helmet', Eyes: 'Angry', Mouth: 'Grit' },
  // NODE BARTENDER: ask about the tape. Mafia shirt, mafia hat, bubblegum.
  'v-noodle': { Skin: 'Purple', Body: 'Blue Mafia', Head: 'Mafia Hat', Eyes: 'Blue Smirk', Mouth: 'Bubblegum' },
  // GLITCH KID: there is a hole in the market tape. Beanie, mixed eyes, rainbow puke.
  'v-hacker': { Skin: 'Green', Body: 'Glitch Hoodie', Head: '8 Ball Beanie', Eyes: 'Clown Eye Mix', Mouth: 'Rainbow Puke' },
  // SPIRE TECH: do not look at the beam. TPS cap, gradient visor, flat mouth.
  'v-spire': { Skin: 'Yellow', Body: 'Astro Suit', Head: '10k TPS Cap', Eyes: 'Gradient visor', Mouth: 'Flat' },
  // NIGHT VENDOR: hot cards, cold drinks. Fire shirt, bucket cap, happy.
  'v-vendor': { Skin: 'Red', Body: 'Fire Shirt', Head: 'Orange Bucket Cap', Eyes: 'Happy', Mouth: 'Smile' },
  // MONORAIL DRIVER: the line goes everywhere the Index does. Jersey, cap, side-eye.
  'v-driver': { Skin: 'Beige', Body: 'Blue 143 Jersey', Head: 'Chog Cap', Eyes: 'Side Eye', Mouth: 'Flat' },
  // ROOFTOP COURIER: mind the gap. Sky hoodie, cloud cap, eyes up, lip bitten.
  'v-roof': { Skin: 'Pink', Body: 'Sky Hoodie', Head: 'Cloud Cap', Eyes: 'Up', Mouth: 'Lip Bite' },
  // MR. HERTZ: the neon is not the only thing glowing here. Same guy, same look.
  'v-hertz': { Skin: 'Multi Colored', Body: 'Glitch Hoodie', Head: '3rd Eye', Eyes: 'Purple laser', Mouth: 'wo' },
  // ---------------------------------------------------------------- hollow
  // HERB DEALER: cards grow on the trellis. Shroom cap, green happy, drooling.
  'h-dealer': { Skin: 'Green', Body: 'Hawaiian Polo', Head: 'Poison Shroom', Eyes: 'Green Happy', Mouth: 'Drooling' },
  // DOCTOR MOSS: everything heals here. Jade skin, white yukata, silver wreath.
  'h-nurse': { Skin: 'Jade', Body: 'White Yukata', Head: 'Silver wreath', Eyes: 'Green Round Eye', Mouth: 'normal smile' },
  // STATION KEEPER: the vines reach the dial. Stripes, peace hat, easy smile.
  'h-operator': { Skin: 'Beige', Body: 'Stripe shirts', Head: 'Peace hat', Eyes: 'Normal', Mouth: 'Smile' },
  // WAR WARDEN: the arcade remembers every score. Red jersey, red horn, flat red stare.
  'h-scribe': { Skin: 'Red', Body: 'Red 143 Jersey', Head: 'Red Horn', Eyes: 'Red Flat', Mouth: 'Grit' },
  // SEED KEEPER: every trait is a seed. Wizard cape, a diamond seed on the brow, vertical eyes.
  'h-archivist': { Skin: 'Jade', Body: 'Wizard Cape', Head: 'Diamond', Eyes: 'Vertical', Mouth: 'Flat' },
  // YARD FOREMAN: do not stand under the crane. Army vest, peace cap, thug stare, gum.
  'h-watchman': { Skin: 'Blue', Body: 'Army Vest', Head: 'Peace Cap', Eyes: 'Thug', Mouth: 'Bubblegum' },
  // TEA MISTRESS: sit. Yellow yukata, a small crown, calm eyes, a smile.
  'h-tea': { Skin: 'Beige', Body: 'Yellow Yukata', Head: 'Crown', Eyes: 'Normal Eye', Mouth: 'Smile' },
  // HEAD GARDENER: the dome keeps the rain out. Orange hoodie, taped banana, frog eyes.
  'h-gardener': { Skin: 'Green', Body: 'Orange Hoodie', Head: 'Taped Banana', Eyes: 'Frog', Mouth: 'Smile' },
  // RESERVOIR WARDEN: the water is deeper than it looks. Shark suit, bucket cap, worried.
  'h-ferryman': { Skin: 'Blue', Body: 'Shark Suit', Head: 'Gray Bucket Cap', Eyes: 'Blue Round Eye', Mouth: 'Worried' },
  // CRANE OPERATOR: she swings both ways. Orange sleeveless, WAGMI cap, side-eye, gum.
  'h-foreman': { Skin: 'Yellow', Body: 'Orange Sleeveless', Head: 'WAGMI Cap', Eyes: 'Side Eye', Mouth: 'Bubblegum' },
  // MARKET HAWKER: greens by the bundle. Red sleeveless, balls cap, XD, wo.
  'h-vendor': { Skin: 'Red', Body: 'Red Sleeveless', Head: 'Balls Cap', Eyes: 'XD', Mouth: 'wo' },
  // MOSS WANDERER: the collapse took the terminal. Mummy wraps, beanie, dead eyes, sad.
  'h-wanderer': { Skin: 'Grey', Body: 'Mummy', Head: 'RH Beanie', Eyes: 'Dead', Mouth: 'Sad' },
  // MR. HERTZ: the plants listen. Same guy, same look.
  'h-hertz': { Skin: 'Multi Colored', Body: 'Glitch Hoodie', Head: '3rd Eye', Eyes: 'Purple laser', Mouth: 'wo' },
};

/** A curated look for this NPC, or null when it dresses off its hash. */
export function npcLookFor(id: string): TraitSet | null {
  const fixed = NPC_LOOKS[id];
  return fixed ? { ...fixed } : null;
}
