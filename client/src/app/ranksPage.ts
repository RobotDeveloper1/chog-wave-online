import type { RankRow, RanksView } from '@chog/shared';

const esc = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * The RANKS tab: four boards, one per thing worth being first at.
 *
 * A renderer like the war board — every figure arrived from the server, so the
 * only work here is columns and the highlight on the reader's own row.
 */
export function renderRanks(ranks: RanksView | null, problem = ''): string {
  if (!ranks) {
    return `<div class="sheet">${
      problem
        ? `<div class="idle" style="color:var(--rose)">${esc(problem)} — is the server running this build?</div>`
        : '<div class="idle">asking the hall of fame…</div>'
    }</div>`;
  }
  const board = (title: string, rows: RankRow[], figure: (r: RankRow) => string, empty: string): string => {
    const body = rows.length
      ? rows
          .map(
            (r, i) =>
              `<div class="rrow ${r.key === ranks.you ? 'you' : ''}"><span class="rk">${i + 1}</span><span class="rn">${esc(r.name)}</span><span class="rv">${figure(r)}</span></div>`,
          )
          .join('')
      : `<div class="idle">${empty}</div>`;
    return `<section class="rboard"><h3>${title}</h3>${body}</section>`;
  };
  return `<div class="sheet ranks"><div class="cols">
    ${board('LEVEL', ranks.level, (r) => `LV ${r.level}`, 'nobody has walked anywhere yet')}
    ${board('PVP', ranks.pvp, (r) => `${r.pvpWins}W–${r.pvpLosses}L`, 'no brawls fought yet — right-click a chog on the street')}
    ${board('$CHOG', ranks.chog, (r) => `${r.chog.toLocaleString()} $CHOG`, 'the vault is the only account')}
    ${board('THE LINE', ranks.line, (r) => (r.lineCleared ? `${r.lineCleared} · ${esc(r.lineRegion)}` : '—'), 'the road is unbeaten')}
  </div></div>`;
}
