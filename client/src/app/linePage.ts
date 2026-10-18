import { ENCOUNTERS, REGIONS, SF, anyCard, type RegionId } from '@chog/shared';
import { cardImg } from './cardArt.ts';

/**
 * The MAPS tab: the Line, and the road along it.
 *
 * **This page is a renderer and nothing else.** It draws the six regions, what the server says
 * about each one, and a button that sends `line.travel`. It computes no gate, decides no
 * unlocked state, and holds no opinion about where a player may stand — `regionGate` in
 * `shared/src/line/index.ts` is the only thing that answers that, and the server calls the same
 * function when the message arrives. A tab that disagreed with the server about a locked region
 * would be a tab that lies to the player before the server has had a chance to disagree back.
 *
 * Which is why the lock text is the gate's own `reason` string, printed verbatim. When the tab
 * says *"TOLLS: the warden is still standing"*, that is the sentence the server will send back
 * if they try it anyway.
 *
 * Travel is **free, and one-way per region**. A player who has crossed Tolls can jump straight
 * to Ash Pine; that is fast travel, and it is why walking the Line's first time is the only time
 * it is a journey. What it does not do is skip a gate, which is the part that would cost the
 * game its spine.
 */

export interface LineView {
  regions: { id: string; name: string; n: number; state: 'done' | 'open' | 'sealed' }[];
  slots: number;
  cards: string[];
  dungeons: { open: boolean; reason: string };
  anomalies: { open: boolean; reason: string };
  at: RegionId;
  onTheLine: boolean;
}

const esc = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

const STATE_LABEL: Record<string, string> = { done: 'CLEARED', open: 'OPEN', sealed: 'SEALED' };

/** One region row: what it is, how far in it is, and the button. */
function regionCard(r: LineView['regions'][number], here: boolean, owned: string[]): string {
  const def = REGIONS.find((x) => x.id === r.id);
  const encs = ENCOUNTERS.filter((e) => e.region === r.id);
  const warden = encs.find((e) => e.kind === 'warden');
  // How much of this region the player has actually walked, from the cards it hands out.
  const state = here ? 'here' : r.state;
  return `
    <li class="mregion ${state}" data-region="${esc(r.id)}">
      <div class="mhead">
        <b>${r.n}. ${esc(r.name)}</b>
        <span class="mstate">${STATE_LABEL[r.state] ?? esc(r.state)}</span>
      </div>
      <p class="mtag">${esc(def?.tagline ?? '')}</p>
      <div class="mfoot">
        <span class="mcount">${encs.length} sites · ${def ? def.encounters.flatMap((e) => e.unlocks).length : 0} cards</span>
        ${here
          ? '<span class="mhere">YOU ARE HERE</span>'
          : r.state === 'sealed'
            ? '<span class="mlock">warden standing</span>'
            : `<button class="mtravel" data-a="travel" data-id="${esc(r.id)}">TRAVEL</button>`}
      </div>
      <div class="mdrops"><span class="mlabel">POSSIBLE DROPS</span>${dropIcons(def, owned)}</div>
      <small class="mboss">${esc(warden ? `${warden.name} — ${regionBoss(r.id)}` : '')}</small>
    </li>`;
}

/** The prize pool: one icon per card the region pays, lit once it is owned. */
function dropIcons(def: (typeof REGIONS)[number] | undefined, owned: string[]): string {
  if (!def) return "";
  const have = new Set(owned);
  const ids = [...new Set(def.encounters.flatMap((e) => e.unlocks))];
  return ids
    .map((id) => {
      const c = anyCard(id);
      if (!c) return "";
      const got = have.has(id);
      const bits = `${c.element} · ${c.power}x${c.hits}${c.klass ? ` · ${c.klass}` : ""}`;
      const what = SF.KIND_READ[SF.cardKind(c)];
      return `<span class="mdrop ${got ? "have" : ""}">${cardImg(id, c.element, "mdrop-art")}<span class="mtip">${cardImg(id, c.element, "mtip-art")}<span class="mtip-tx"><b>${esc(c.name)}</b><small>${esc(bits)}</small><small class="mwhat">${esc(what)}</small><small>${got ? "owned" : "not yours yet"}</small></span></span></span>`;
    })
    .join("");
}

function regionBoss(id: string): string {
  const r = REGIONS.find((x) => x.id === id);
  return r ? `${r.boss.name} (${r.boss.archetype})` : '';
}

export function linePage(v: LineView | null, problem = ''): string {
  if (!v) {
    // Say *why*. A page that reads "asking the road…" forever is indistinguishable from a page
    // that is working, and that is exactly how a server from before the Line looks from here.
    return `<div class="page">${
      problem
        ? `<p class="muted" style="color:var(--rose)">${esc(problem)}</p>`
        : '<p class="muted">asking the road…</p>'
    }</div>`;
  }
  const done = v.regions.filter((r) => r.state === 'done').length;
  const head = `
    <div class="linehead">
      <div><b>THE LINE</b><small>${done}/${v.regions.length} regions · ${v.cards.length} cards · deck ${v.slots} slots</small></div>
      ${v.onTheLine ? `<button class="mback" data-a="travel" data-id="">LEAVE THE LINE</button>` : '<span class="mlock">you are in the city</span>'}
    </div>`;

const rows = v.regions.map((r) => regionCard(r, v.onTheLine && r.id === v.at, v.cards)).join('');

  // The two phase-two gates, printed with the server's own reasons. This is where a player learns
  // that the dungeons want a *hand* and not a level, which is the whole argument of the Line.
  const phases = `
    <div class="mphase">
      <div class="${v.dungeons.open ? 'open' : 'shut'}">
        <b>DATA AREAS</b>
        <small>${v.dungeons.open ? 'open — the folds are waiting' : esc(v.dungeons.reason)}</small>
      </div>
      <div class="${v.anomalies.open ? 'open' : 'shut'}">
        <b>ANOMALIES</b>
        <small>${v.anomalies.open ? 'the market can reach you here' : esc(v.anomalies.reason)}</small>
      </div>
    </div>`;

  return `<div class="page">${head}<ol class="mlist">${rows}</ol>${phases}</div>`;
}