import type { AlbumUniverse } from './album.ts';

/**
 * The collection as a checklist, lifted verbatim from `.data/traits.json`.
 * Each value carries how many tokens in the scanned sample wear it, which is the
 * rarity signal the Album pays out on. Generated — edit the JSON and re-run
 * `node tools/gen-album.mjs`, not this file.
 */
export const ALBUM_UNIVERSE: AlbumUniverse = {
  "Background": { "Aqua": 40, "Light Purple": 38, "Coral Pink": 37, "Mon": 36, "Lemon": 36, "Rosie": 32, "Sunlight": 29, "Sky Blue": 29, "Light Magenta": 27, "Mint": 27, "Lemon Yellow": 25, "Aqua Mint": 23, "Peach Pink": 23, "Soft Lavender": 21, "Fresh Green": 20, "Lime Green": 13, "Deep Aqua": 12, "Rosy Pink": 10, "Deep Blue": 9, "Radioactive": 4, "Afternoon Orange": 1 },
  "Base": { "Origin": 474, "Skull": 14, "Radioactive": 4, "1:1": 1 },
  "Skin": { "Pink": 139, "Origin": 135, "Red": 77, "Black": 69, "Yellow": 61, "White": 3, "Blue": 2, "Metal": 2, "Green": 1, "Jade": 1, "Purple": 1, "Grey": 1 },
  "Side": { "Right": 340, "Left": 152 },
  "Body": { "Kings Robe": 14, "Blue Chinese": 12, "Inmate": 11, "Squid Game Guard": 11, "Gangster suit": 11, "Tuxedo": 11, "Black Trackset": 10, "Red Tuxedo": 10, "CWO": 10, "Chug Life": 10, "Dragon suit": 10, "Banana suit": 10, "Prisoner": 9, "Cream Tuxedo": 8, "Black Shirt": 8, "White Pure Shirt": 8, "Farmer Shirt": 8, "Yellow Shirt": 8, "Astro Suit": 8, "Yellow Yukata": 8, "Red Trackset": 7, "Aqua Tuxedo": 7, "Hawaiian Polo": 7, "Stripes": 7, "Jesus": 7, "Tank Top": 7, "Black Vest": 7, "Wizard": 6, "Duck Float": 6, "Yellow Hoodie": 6, "MILF Lover": 6, "Brown Homeless Shirt": 6, "Six Seven": 6, "Yellow 143 Jersey": 5, "dark vest": 5, "Fire Shirt": 5, "Pink Tuxedo": 5, "White tuxedo": 5, "Red Sleeveless": 5, "Squid Game": 5, "Cyan tuxedo": 5, "toad blue suit": 5, "Mon Hoodie": 4, "Red Chinese": 4, "Orange Sleeveless": 4, "Grey Shirt": 4, "White Yukata": 4, "Red jacket": 4, "Golden Armor": 4, "Sci Fi": 4, "Toad pink suit": 4, "Grey Homeless Shirt": 4, "Glitch Hoodie": 4, "dark tee": 4, "Red shirt": 4, "pink vest": 4, "Orange Hoodie": 3, "dark jacket": 3, "BBC": 3, "Red 143 Jersey": 3, "White Sleeveless": 3, "Blue tuxedo": 3, "White Shirt": 3, "Shark Suit": 3, "Pink Shirt": 3, "Toad green Suit": 3, "Peach Hoodie": 3, "Blue 143 Jersey": 3, "Guko": 2, "Purple Shirt": 2, "CEO Vest": 2, "Blue jacket": 2, "Army Vest": 2, "Blue Homeless Shirt": 2, "Virgin": 2, "Electro Hoodie": 2, "Sky Hoodie": 2, "red tee": 1, "purple vest": 1, "Stripe shirts": 1, "Blue Holed Jacket": 1, "Gojo": 1, "Zero THOTS": 1, "Boner": 1 },
  "Mouth": { "normal smile": 58, "Bubblegum": 48, "Sad": 44, "Drooling": 43, "Smile": 42, "Worried": 39, "Rainbow Puke": 38, "Lip Bite": 30, "Gold Tooth": 27, "wo": 26, "Flat": 16, "Clown Mouth": 14, "BTC Coin": 12, "Grit": 10, "Mon coin": 7 },
  "Eyes": { "Happy": 37, "Purple laser": 28, "fire laser": 28, "Dead": 25, "Normal Eye": 23, "Side Eye": 22, "Closed Eye Crying": 21, "Round Crying": 19, "Sunset visor": 19, "Gradient visor": 18, "Heart": 17, "Retro Glass": 16, "Green laser": 15, "Tired": 14, "Round": 13, "Round Eye": 13, "Teary": 11, "Clown Eye Mix": 11, "Anime Glass": 11, "Angry": 11, "Vertical": 11, "Round Tear": 10, "Smirk": 9, "Modern VR": 8, "Flat": 7, "MOG": 7, "Plasma visor": 7, "Base": 6, "Chog Viper": 6, "Retard": 6, "Classic VR": 6, "Clown Eye": 5, "Frog": 5, "cyan laser": 5, "Worried": 4, "XD": 4, "BTC Glass": 3, "Thug": 3, "3D Glass": 3, "Green Side Eye": 1, "Blue Flat": 1, "Red Round Eye": 1, "Blue Retard": 1, "Up": 1 },
  "Head": { "Balls Cap": 20, "Star Cap": 17, "Wizard Hat": 14, "Mon Cap": 14, "Orange Bucket Cap": 14, "Russian Hat": 13, "Red Headband": 13, "Red Peace Cap": 12, "TISM Cap": 12, "Horny Cap": 12, "Plumber": 12, "Dollar Cap": 12, "Boob Cap": 12, "Cloud Cap": 11, "MMGA Cap": 11, "Gray Bucket Cap": 11, "Spartan Helmet": 11, "Clown Nose": 11, "Bob Hair": 10, "Durag": 10, "Peace hat": 10, "Thunder Cap": 9, "Crown": 9, "JEET Cap": 9, "Robber": 9, "MEGA Chog": 8, "Japan Headband": 8, "Blue Bucket Cap": 8, "RETARD Cap": 8, "WAGMI Cap": 8, "10k TPS Cap": 8, "BTC Cap": 8, "Choggie Cap": 8, "MCGA": 7, "Buttcoin Cap": 6, "RH Beanie": 6, "Chog Cap": 5, "BTC Beanie": 5, "Wizard Beanie": 5, "Rainbow Wig": 4, "Choggie Beanie": 3, "NEET": 3, "Mon Beanie": 3, "Gold Thorn": 3, "MCGA Cap": 2, "BOOB Cap": 1, "Silver Thorn": 1, "3rd Eye": 1, "Purple Horn": 1, "Holy Seal": 1, "Head Wrap": 1, "ETH Cap": 1 },
  "Accessory": { "Fwog": 7, "Knife": 7, "Coin": 6, "Heart": 5, "Green Candle": 5, "Cigar": 4, "Red Candle": 3, "SB": 3, "PEPE": 2 },
  "Form": { "Chog": 478, "Skull": 14 },
  "Tier": { "Common": 333, "Uncommon": 141, "Rare": 14, "Epic": 4, "Legendary": 1 },
  "Naked": { "No": 481, "Yes": 11 },
  "Aura": { "Purple": 25, "Royal Blue Aura": 19, "Rose Aura": 19, "Wind": 18, "Burning Aura": 18, "Fiery Aura": 17, "Royal Aura": 16, "Mint": 15, "Light Purple": 14, "Cool Aura": 14, "Aqua Aura": 12, "Fire": 12, "Violet": 12, "Smoke": 10, "Yellow Aura": 10, "Clean": 9, "Rose Scent": 2, "Pink Mist": 1, "Electric Shock": 1, "Green Aura": 1 },
};

export const ALBUM_CATEGORIES = Object.keys(ALBUM_UNIVERSE) as (keyof AlbumUniverse)[];

export const ALBUM_TOTAL = 272;

/** How many tokens the frequency counts were taken over. */
export const ALBUM_SAMPLE = 493;
