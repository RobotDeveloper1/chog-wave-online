import { ICON } from './icons.ts';
import { setStick } from '../player.ts';

/** What the street needs from a finger. Every one of these is a verb the keys already have. */
export interface TouchHandlers {
  act(): void;
  menu(): void;
  map(): void;
  viz(): void;
  /** One quarter turn of the isometric lens, the same step Q and R take. */
  turn(dir: 1 | -1): void;
  /** Multiply the camera zoom, from a pinch. */
  zoom(factor: number): void;
}

export interface TouchLayer {
  /** Off while a duel or a dialogue owns the picture, on for the street. */
  setActive(on: boolean): void;
  /** Lights the act button when something is in reach. */
  setReach(on: boolean): void;
  dispose(): void;
}

const DEAD = 0.22;
const RUN = 0.85;
const RADIUS = 58;
/** How far a drag has to travel to be worth a quarter turn. */
const SWIPE = 46;

/**
 * Anything you can already tap stays tappable: a gesture that begins on a plate, on the lower
 * screen or on a duel widget is handed back to the DOM untouched. Only a touch on the bare
 * picture drives the avatar.
 */
const OWNED = '.hit, #bottom, #duel, #touch, #hud-levelup, #hud-dialogue, input, button';

interface Track {
  role: 'stick' | 'turn';
  x: number;
  y: number;
  ox: number;
  oy: number;
}

/**
 * `surface` is the picture, which is where the gestures are captured; `mount` is the HUD layer,
 * which is where the widgets live, so that the rule that clears the HUD for a duel clears this
 * too. A gesture that begins on anything already tappable is handed back to the DOM.
 */
export function createTouchLayer(surface: HTMLElement, mount: HTMLElement, h: TouchHandlers): TouchLayer {
  const wrap = document.createElement('div');
  wrap.id = 'touch';
  wrap.innerHTML = `
    <div class="tstick"><i class="ring"></i><i class="knob"></i></div>
    <div class="tverbs">
      <div class="tstack">
        <button class="tside hit" data-t="map" aria-label="map">${ICON.pin}</button>
        <button class="tside hit" data-t="viz" aria-label="visualizer">${ICON.wave}</button>
        <button class="tside hit" data-t="menu" aria-label="menu">${ICON.menu}</button>
      </div>
      <button class="tact hit" data-t="act" aria-label="act">${ICON.bolt}</button>
    </div>`;
  mount.appendChild(wrap);

  const stickEl = wrap.querySelector<HTMLElement>('.tstick')!;
  const knob = wrap.querySelector<HTMLElement>('.knob')!;
  const actBtn = wrap.querySelector<HTMLElement>('.tact')!;

  const ptrs = new Map<number, Track>();
  let pinch: number | null = null;
  let live = false;

  const release = (): void => {
    setStick(0, 0, false);
    stickEl.classList.remove('on');
    knob.style.transform = 'translate(-50%, -50%)';
  };

  // A pinch is measured between the first two fingers down, whatever else is waiting.
  const pair = (): [Track, Track] | null => {
    const it = ptrs.values();
    const a = it.next().value;
    const b = it.next().value;
    return a && b ? [a, b] : null;
  };

  const onDown = (e: PointerEvent): void => {
    if (!live) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.(OWNED)) return;
    e.preventDefault();
    const rect = surface.getBoundingClientRect();
    const role: 'stick' | 'turn' = e.clientX - rect.left < rect.width * 0.52 ? 'stick' : 'turn';
    ptrs.set(e.pointerId, { role, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
    if (ptrs.size === 2) {
      const two = pair();
      if (two) {
        const [a, b] = two;
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        if (a.role === 'stick' || b.role === 'stick') release();
      }
      return;
    }
    if (role === 'stick') {
      stickEl.style.left = `${e.clientX - rect.left}px`;
      stickEl.style.top = `${e.clientY - rect.top}px`;
      stickEl.classList.add('on');
    }
  };

  const onMove = (e: PointerEvent): void => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch !== null && ptrs.size >= 2) {
      const two = pair();
      if (two) {
        const [a, b] = two;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 12 && d > 12) h.zoom(d / pinch);
        pinch = d;
      }
      return;
    }
    if (p.role === 'stick') {
      const dx = p.x - p.ox;
      const dy = p.y - p.oy;
      const far = Math.hypot(dx, dy);
      if (far < 1) return;
      const k = far / RADIUS;
      const clamped = Math.min(k, 1);
      knob.style.transform = `translate(calc(-50% + ${(dx / far) * clamped * RADIUS}px), calc(-50% + ${(dy / far) * clamped * RADIUS}px))`;
      if (k < DEAD) setStick(0, 0, false);
      else setStick((dx / far) * k, (dy / far) * k, k > RUN);
      return;
    }
    // Walk the drag in fixed steps, so one long sweep can turn more than a quarter.
    while (Math.abs(p.x - p.ox) > SWIPE) {
      const right = p.x - p.ox > 0;
      p.ox += (right ? 1 : -1) * SWIPE;
      h.turn(right ? -1 : 1);
    }
  };

  const onUp = (e: PointerEvent): void => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (p?.role === 'stick' && ![...ptrs.values()].some((q) => q.role === 'stick')) release();
  };

  const onTap = (e: Event): void => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const kind = b.dataset.t;
    if (kind === 'act') h.act();
    else if (kind === 'map') h.map();
    else if (kind === 'menu') h.menu();
    else if (kind === 'viz') h.viz();
  };

  const onMenu = (e: Event): void => {
    if (live) e.preventDefault();
  };

  surface.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  wrap.addEventListener('click', onTap);
  addEventListener('contextmenu', onMenu);

  return {
    setActive(on: boolean) {
      live = on;
      wrap.classList.toggle('off', !on);
      if (!on) {
        ptrs.clear();
        pinch = null;
        release();
      }
    },
    setReach(on: boolean) {
      actBtn.classList.toggle('ready', on);
    },
    dispose() {
      surface.removeEventListener('pointerdown', onDown);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('contextmenu', onMenu);
      wrap.remove();
    },
  };
}
