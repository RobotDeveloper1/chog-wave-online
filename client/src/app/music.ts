/**
 * The score, and the pulse the front door dances to.
 *
 * Four beds, all rendered from the project's own track (`CHOG WORLD ORDER`) with different
 * chains, so the game sounds like one place rather than four stock loops:
 *
 *   login    slow, dusty, top rolled off at 5k — the lo-fi version
 *   street   a dub of it: open, short delay on the tail, warm low end
 *   duel     pushed the other way: faster, tight, pumping
 *   dungeon  underwater: 28% slower, nothing above 3.2k, long echoes
 *
 * Each file is a *seamless* loop — the tail crossfaded over the head — so a player who sits
 * on the gate for two minutes never hears a join.
 *
 * Two things the browser forces on any game with music. Nothing plays before a gesture, so
 * `arm()` waits for the first pointer or key and the gate shows a real play/pause control
 * instead of pretending audio is free. And the login screen wants to *move* to the track, so
 * the element is tapped into WebAudio and its low bins are published as a 0..1 `--beat` on
 * the root element: the pulse measured from the audio actually playing, not from a BPM
 * guessed in advance.
 */

export type Scene = 'login' | 'street' | 'duel' | 'dungeon';

const SRC: Record<Scene, string> = {
  login: '/audio/chog-wave-login.ogg',
  street: '/audio/chog-wave-street.ogg',
  duel: '/audio/chog-wave-duel.ogg',
  dungeon: '/audio/chog-wave-dungeon.ogg',
};

/** A fade, not a cut: a hard start on a gate page reads as a bug even when it sounds fine. */
const FADE_MS = 900;
const LEVEL = 0.5;

class Music {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array | null = null;
  private raf = 0;
  private where: Scene | null = null;
  private armed = false;
  private muted = false;
  /** Peak-decayed: raw bass energy flickers too fast to look like breathing. */
  private pulse = 0;

  get playing(): boolean {
    return !!this.el && !this.el.paused && !this.muted;
  }

  current(): Scene | null {
    return this.where;
  }

  /** Called from the first real gesture; before that, `play()` only records the intent. */
  arm(): void {
    if (this.armed) return;
    this.armed = true;
    if (this.where) void this.start(this.where);
  }

  play(next: Scene): void {
    if (this.where === next) return;
    this.where = next;
    if (this.armed) void this.start(next);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.el) this.el.volume = this.muted ? 0 : LEVEL;
    return this.muted;
  }

  /**
   * The one button the gate offers. It has to *start* the score for somebody who has never
   * heard it — a control that mutes a track that was never playing is how a game page ends
   * up silent with a pause glyph on it.
   */
  toggle(): boolean {
    const el = this.el;
    if (el && !el.paused && !this.muted) {
      this.muted = true;
      el.volume = 0;
      return true;
    }
    this.muted = false;
    this.armed = true;
    if (el && el.paused) {
      void el.play().then(() => this.fadeIn(el), () => undefined);
      return false;
    }
    this.where ??= 'login';
    void this.start(this.where);
    return false;
  }

  private async start(next: Scene): Promise<void> {
    const previous = this.el;
    if (previous && previous.src.endsWith(SRC[next])) return;

    const audio = new Audio(SRC[next]);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    this.tap(audio);
    try {
      await audio.play();
    } catch {
      // Not armed yet, or the gesture expired. `arm()` retries; the gate stays usable.
      // Retire the old bed anyway: `this.el` points at the new one from here on, so a
      // previous bed left running is a score nobody holds a handle to -- it cannot be
      // faded, paused or muted again. That is exactly how the login track ended up
      // playing under the street.
      if (previous && !previous.paused) this.fadeOut(previous);
      return;
    }
    // Adopt the new bed only once it is really making sound, so a half-started scene can
    // never leave the previous one stranded behind it.
    this.el = audio;
    this.fadeIn(audio);
    if (previous && !previous.paused) this.fadeOut(previous);
  }

  /**
   * Route the element through WebAudio so the graph that measures the bass is also the one
   * that can go silent. A media-element source can only be created once per element, which
   * is why every bed gets a fresh <audio> instead of a swapped `src`.
   */
  private tap(audio: HTMLAudioElement): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx ??= new AC();
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.72;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.connect(this.ctx.destination);
      if (new URLSearchParams(location.search).has('capture')) (window as unknown as { __musicTap?: AnalyserNode }).__musicTap = this.analyser;
    }
    try {
      this.ctx.createMediaElementSource(audio).connect(this.analyser);
    } catch {
      return;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.raf) this.tick();
  }

  private tick(): void {
    this.raf = requestAnimationFrame(() => this.tick());
    if (!this.analyser || !this.bins || this.muted) return;
    this.analyser.getByteFrequencyData(this.bins as Uint8Array<ArrayBuffer>);
    // The kick lives in the first handful of bins at any sample rate worth caring about.
    let sum = 0;
    for (let i = 1; i < 7; i++) sum += this.bins[i] ?? 0;
    this.pulse = Math.max(sum / (6 * 255), this.pulse * 0.88);
    document.documentElement.style.setProperty('--beat', this.pulse.toFixed(3));
  }

  private fadeIn(el: HTMLAudioElement): void {
    const started = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - started) / FADE_MS);
      el.volume = this.muted ? 0 : LEVEL * k;
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  private fadeOut(el: HTMLAudioElement): void {
    const from = el.volume;
    const started = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - started) / FADE_MS);
      el.volume = from * (1 - k);
      if (k < 1) requestAnimationFrame(step);
      else el.pause();
    };
    step();
  }
}

export const music = new Music();

/**
 * The duel screen mounts and unmounts its own DOM under a stable id, so the score can
 * follow it without the shell being edited. Dungeons are not observable from here: whoever
 * owns that transition should call `music.play('dungeon')` on the way in and
 * `music.play('street')` on the way out.
 */
export function watchScenes(): () => void {
  const arm = (): void => {
    music.arm();
    removeEventListener('pointerdown', arm);
    removeEventListener('keydown', arm);
  };
  addEventListener('pointerdown', arm);
  addEventListener('keydown', arm);

  let inDuel = false;
  const observer = new MutationObserver(() => {
    const duel = !!document.getElementById('duel');
    if (duel === inDuel) return;
    inDuel = duel;
    music.play(duel ? 'duel' : 'street');
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    removeEventListener('pointerdown', arm);
    removeEventListener('keydown', arm);
  };
}
