import { setSfxVolume, toggleMute } from '../../audio.ts';
import { setMusicMuted } from '../../music.ts';
import { QUALITY_PRESET, getSettings, resetSettings, updateSettings, type Quality, type UiScale } from '../../settings.ts';

/**
 * The OPTIONS tab. Sliders apply live (no repaint, so a drag never loses the
 * thumb); buttons repaint so pressed states refresh. Mute follows the same
 * path as the N key: audio graph first, settings mirror second.
 */
export function renderOptions(): string {
  const s = getSettings();
  const music = Math.round(s.sound.music * 100);
  const sfx = Math.round(s.sound.sfx * 100);
  const seg = <T extends string>(group: string, opts: readonly { v: T; label: string }[], cur: T): string =>
    `<div class="seg" role="group">${opts.map((o) => `<button type="button" data-${group}="${o.v}" class="${o.v === cur ? 'on' : ''}" aria-pressed="${o.v === cur ? 'true' : 'false'}">${o.label}</button>`).join('')}</div>`;
  const tgl = (attr: string, on: boolean, label: string): string =>
    `<button type="button" data-${attr} class="tgl ${on ? 'on' : ''}" aria-pressed="${on ? 'true' : 'false'}">${on ? 'ON' : 'OFF'} · ${label}</button>`;

  return `<div class="opt">
<h2 class="head">OPTIONS</h2>
<h3 class="sub">SOUND</h3>
<div class="row"><div class="grow"><b>Mute all</b><br><span class="note">Same as the N key. Saved for next boot.</span></div>${tgl('mute', s.sound.muted, 'MUTED')}</div>
<div class="row"><div class="grow"><b>Music</b><br><span class="note">Title, city, duel, dungeon and Line themes.</span></div><input type="range" data-vol="music" min="0" max="100" value="${music}" aria-label="Music volume"><span class="val" data-val="music">${music}</span></div>
<div class="row"><div class="grow"><b>Effects</b><br><span class="note">UI clicks, battle cries, ambience.</span></div><input type="range" data-vol="sfx" min="0" max="100" value="${sfx}" aria-label="Effects volume"><span class="val" data-val="sfx">${sfx}</span></div>
<h3 class="sub">GRAPHICS</h3>
<div class="row"><div class="grow"><b>Quality</b><br><span class="note">Performance: faster pixels, no shadows. Also resets Effects below — retoggle after.</span></div>${seg('q', [{ v: 'performance', label: 'PERF' }, { v: 'balanced', label: 'BALANCED' }, { v: 'ultra', label: 'ULTRA' }] as const, s.graphics.quality)}</div>
<div class="row"><div class="grow"><b>Effects</b><br><span class="note">Bloom, vignette and colour grade. Off is the cheaper path.</span></div>${tgl('post', s.graphics.post, 'POST')}</div>
<h3 class="sub">ACCESSIBILITY</h3>
<div class="row"><div class="grow"><b>Reduce motion</b><br><span class="note">No camera shake in battle or menu flashes. Duel telegraphs stay — they are gameplay.</span></div>${tgl('motion', s.a11y.reduceMotion, 'CALM')}</div>
<div class="row"><div class="grow"><b>Interface size</b><br><span class="note">HUD text and menus only. The 3D view never scales.</span></div>${seg('ui', [{ v: 'compact', label: 'COMPACT' }, { v: 'normal', label: 'NORMAL' }, { v: 'large', label: 'LARGE' }] as const, s.a11y.uiScale)}</div>
<h3 class="sub">RESET</h3>
<div class="row"><div class="grow"><b>Defaults</b><br><span class="note">Balanced, post on, full sound, calm off, normal size.</span></div><button type="button" data-reset>RESTORE</button></div>
</div>`;
}

export function bindOptions(el: HTMLElement, repaint: () => void): void {
  const q = <T extends HTMLElement>(sel: string): T | null => el.querySelector<T>(sel);
  const qa = (sel: string): NodeListOf<HTMLElement> => el.querySelectorAll<HTMLElement>(sel);

  qa('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const next = (b.dataset.q ?? 'balanced') as Quality;
    updateSettings((d) => {
      d.graphics.quality = next;
      d.graphics.post = QUALITY_PRESET[next].post;
    });
    repaint();
  }));
  const post = q('[data-post]');
  post?.addEventListener('click', () => {
    updateSettings((d) => { d.graphics.post = !d.graphics.post; });
    repaint();
  });
  const motion = q('[data-motion]');
  motion?.addEventListener('click', () => {
    updateSettings((d) => { d.a11y.reduceMotion = !d.a11y.reduceMotion; });
    repaint();
  });
  qa('[data-ui]').forEach((b) => b.addEventListener('click', () => {
    const next = (b.dataset.ui ?? 'normal') as UiScale;
    updateSettings((d) => { d.a11y.uiScale = next; });
    repaint();
  }));
  const mute = q('[data-mute]');
  mute?.addEventListener('click', () => {
    const off = toggleMute();
    setMusicMuted(off);
    updateSettings((d) => { d.sound.muted = off; });
    repaint();
  });
  qa('[data-vol]').forEach((r) => r.addEventListener('input', () => {
    const input = r as HTMLInputElement;
    const v = Math.min(100, Math.max(0, Number(input.value))) / 100;
    const which = input.dataset.vol === 'sfx' ? 'sfx' : 'music';
    updateSettings((d) => { d.sound[which] = v; });
    const label = q(`[data-val="${which}"]`);
    if (label) label.textContent = String(Math.round(v * 100));
  }));
  const reset = q('[data-reset]');
  reset?.addEventListener('click', () => {
    const wasMuted = getSettings().sound.muted;
    resetSettings();
    if (wasMuted) {
      // Settings say unmuted now; swing the audio graph back the same way.
      toggleMute();
      setMusicMuted(false);
    }
    // Volumes apply through the subscriber; make sure the SFX graph heard it.
    setSfxVolume(getSettings().sound.sfx);
    repaint();
  });
}
