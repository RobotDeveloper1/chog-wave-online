import './pages.css';
import { GATES, QUEST_BY_ID, journey, type JourneyStep, type ProfileView } from '@chog/shared';

/**
 * The CAREER page: the answer to "what am I working toward?". On the left the main road in its
 * five Acts — every step, which are done, which is in hand, which is offered and which is still
 * shut — and on the right the ladder of what each level unlocks, with the next rung lit.
 *
 * It computes nothing. The Acts, the steps and the rungs come from `shared/`, the same tables
 * the server reads when it decides what a level opens, so this page cannot promise a thing the
 * game will not deliver.
 */

const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const MARK: Record<JourneyStep['state'], string> = { done: '✓', ready: '★', active: '▶', next: '●', locked: '○' };

function step(s: JourneyStep): string {
  const doing = s.state === 'active' || s.state === 'next' || s.state === 'ready' ? QUEST_BY_ID.get(s.id)?.doing : '';
  const note =
    s.state === 'ready' ? 'finished — hand it in' : s.state === 'next' ? `offered · ${esc(doing ?? '')}` : s.state === 'active' ? esc(doing ?? '') : s.state === 'locked' && s.level > 1 ? `needs LV ${s.level}` : '';
  return `<li class="${s.state}"><i>${MARK[s.state]}</i><span><b>${esc(s.name)}</b>${note ? `<small>${note}</small>` : ''}</span></li>`;
}

export function renderCareer(p: ProfileView): string {
  const acts = journey(
    p.mainDone ?? [],
    p.quests.filter((q) => q.main).map((q) => ({ id: q.id, done: q.done })),
    p.level,
  );
  const road = acts
    .map(
      (a) => `<div class="act ${a.state}">
        <div class="ah"><b>ACT ${ROMAN[a.act.id] ?? a.act.id} · ${esc(a.act.name)}</b><span class="n">${a.done}/${a.steps.length}</span></div>
        <div class="ab"><i style="width:${Math.round((a.done / Math.max(1, a.steps.length)) * 100)}%"></i></div>
        ${a.state === 'locked' ? `<p>${esc(a.act.blurb)} <em>opens at LV ${a.act.level}</em></p>` : `<p>${esc(a.act.blurb)}</p>`}
        ${a.state === 'locked' ? '' : `<ol>${a.steps.map(step).join('')}</ol>`}
      </div>`,
    )
    .join('');

  const upcoming = GATES.find((g) => g.at > p.level);
  const ladder = GATES.map((g) => {
    const state = p.level >= g.at ? 'done' : g === upcoming ? 'next' : 'locked';
    return `<div class="lr ${state}"><b>LV ${g.at}</b><span>${esc(g.label)}<small>${esc(g.detail)}</small></span><i>${state === 'done' ? '✓' : state === 'next' ? `in ${g.at - p.level}` : ''}</i></div>`;
  }).join('');

  // The ladder on the right says what levels give; this line says what you already took. Without it
  // the page answers "what is ahead" and leaves "how strong am I now" to a screenshot of a fight.
  const u = p.unlocks;
  const now = `<p class="cr-now"><b>yours now</b><span>field ${u.fieldHp}</span><span>queue ${u.queueSlots}</span><span>laser ${u.laserCharges}</span><span>bag ${u.bagCap}</span><span title="charge cooldown — under 1 fires faster">charge ×${u.chargeScale.toFixed(2)}</span><span>mega +${u.megaSlots}</span><span>giga +${u.gigaSlots}</span><span>fused +${u.fusedSlots}</span></p>`;

  const st = p.stats;
  return `<div class="career">
    <header class="cr-head">
      <span class="lv">LV ${p.level}</span>
      <span class="bar"><i style="width:${Math.round(p.pct * 100)}%"></i></span>
      <span class="num">${p.into}/${p.need} xp</span>
      <span class="wav">${p.wav.toLocaleString()} WAV</span>
    </header>
    <div class="cr-cols">
      <section class="cr-road"><h3>THE ROAD</h3><div class="cr-scroll">${road}</div></section>
      <section class="cr-ladder"><h3>WHAT EACH LEVEL OPENS</h3>${now}<div class="cr-scroll">${ladder}</div></section>
    </div>
    <footer class="cr-stats">
      <span><b>${st.clears}</b> anomalies</span><span><b>${st.stormClears}</b> storms</span><span><b>${st.trains}</b> sims</span>
      <span><b>${st.fusions}</b> fusions</span><span><b>${st.dodges}</b> dodges</span><span><b>${st.areas}</b> folds closed</span>
      <span><b>${p.questsDone}</b>/${p.questsTotal} quests</span>
    </footer>
  </div>`;
}
