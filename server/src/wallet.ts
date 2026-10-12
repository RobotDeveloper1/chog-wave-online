import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deriveBuild, type ChogSource, type HolderCard, type HoldingsView } from '@chog/shared';
import { CFG } from './config.ts';
import { traits } from './meta.ts';
import { ledger } from './ledger.ts';
import { ownership } from './owners.ts';

/**
 * The wallet's view of its own Chogs.
 *
 * The client is not trusted with any of this. It could send a tokenId it does not
 * own, or invent trait values, and until now the server would have built a player
 * out of whatever arrived. So the picker reads its cards from here — the same
 * `deriveBuild` the world will run at join time, with the same provenance the
 * formula needs — and a join is still checked against ownership separately.
 */

const spriteCache = new Map<number, string | null>();

/** Atlases are baked per token and streamed by `GET /chogs/<id>.png`; not all exist yet. */
function spriteFor(tokenId: number): string | null {
  const hit = spriteCache.get(tokenId);
  if (hit !== undefined) return hit;
  const file = join(process.cwd(), CFG.spritesDir, `${tokenId}.png`);
  const url = existsSync(file) ? `/chogs/${tokenId}.png` : null;
  spriteCache.set(tokenId, url);
  return url;
}

/** The `ChogSource` provenance produces for one token and one holder. */
export function sourceFor(tokenId: number, holder?: string | null): ChogSource {
  const known = traits.for(tokenId);
  const prov = ledger.provenance(tokenId, holder);
  return {
    tokenId,
    transferCount: prov.transferCount,
    daysHeld: prov.daysHeld,
    mintBlock: prov.mintBlock,
    attributes: known.attributes,
  };
}

/**
 * The signed-in wallet's Chogs, as the picker needs them.
 *
 * `holder` is passed to provenance so `daysHeld` is only ever claimed for the
 * wallet that actually holds the token — asking about somebody else's Chog returns
 * its transfer count and zero days, which is the truth rather than a free build.
 *
 * `ready` is carried because the ownership index is built by scanning the chain,
 * and a wallet that holds three Chogs asked mid-scan would otherwise be told it
 * holds none. That is not an empty state, it is a lie.
 */
export function holdingsView(address: string): HoldingsView {
  const key = address.toLowerCase();
  const tokens = ownership.holdings(key).map((tokenId) => {
    const known = traits.for(tokenId);
    const provenance = ledger.provenance(tokenId, key);
    const source: ChogSource = {
      tokenId,
      transferCount: provenance.transferCount,
      daysHeld: provenance.daysHeld,
      mintBlock: provenance.mintBlock,
      attributes: known.attributes,
    };
    const build = deriveBuild(source);
    const history = ledger.history(tokenId);
    return {
      tokenId,
      attributes: known.attributes,
      traitsSource: known.source,
      element: build.loadout.element,
      tier: known.attributes.Tier ?? '',
      callsign: build.callsign,
      linkSlots: build.linkSlots,
      provenance,
      heldSince: history?.since ?? 0,
      lastSaleTs: history?.last ?? 0,
      sprite: spriteFor(tokenId),
      build,
    } satisfies HolderCard;
  });
  return {
    address: key,
    tokens,
    ready: ownership.ready && ledger.done,
    coverage: ownership.coverage,
    history: ledger.coverage,
  };
}
