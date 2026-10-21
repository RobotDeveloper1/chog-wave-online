import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FURNITURE, HOUSE_SPAWN } from '@chog/shared';

/**
 * Housing, from the server's side: buying furniture, arranging the room, and
 * calling a friend over.
 *
 * The trust boundaries are the whole test file: a guest's place/pickup/rotate is
 * refused even when the piece and the coordinates are perfect, a bare `move`
 * naming 'house' opens nothing without a host, and a street player never sees
 * the people inside the rooms.
 */

let dir: string;
let World: typeof import('../src/world.ts').World;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chog-house-'));
  process.env.DATA_DIR = dir;
  process.env.META_DIR = join(dir, 'no-metadata');
  process.env.FEED = 'synthetic';
  ({ World } = await import('../src/world.ts'));
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 11));
});
afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* windows keeps the sqlite handle a moment */
  }
});

function fresh(token = 4001) {
  const world = new World();
  const p = world.join(`p${token}`, { tokenId: token, transferCount: 0, daysHeld: 0 }, 'ashflat');
  return { world, p, id: p.id, token };
}

function joinAs(world: InstanceType<typeof World>, token: number) {
  const p = world.join(`p${token}`, { tokenId: token, transferCount: 0, daysHeld: 0 }, 'ashflat');
  return { p, id: p.id, token };
}

describe('the furniture counter', () => {
  it('sells the catalogue at fixed prices', () => {
    const { world, id, token } = fresh();
    const res = world.loop(id, { action: 'buy', kind: 'furniture', stockId: 'stool' });
    expect(res.ok).toBe(true);
    expect(world.profiles.houseOf(token).owned.stool).toBe(1);
    expect(world.profiles.doc(token).bag.wav).toBe(120 - FURNITURE.stool!.price);
  });

  it('refuses what is not for sale and what the purse cannot hold', () => {
    const { world, id } = fresh();
    expect(world.loop(id, { action: 'buy', kind: 'furniture', stockId: 'throne-room' }).ok).toBe(false);
    expect(world.loop(id, { action: 'buy', kind: 'furniture', stockId: 'throne' }).ok).toBe(false);
  });

  it('lists furniture on the shelf next to cards and supply', () => {
    const { world, token } = fresh();
    const shops = world.profiles.shops(token, 'ashflat', 0);
    expect(shops.furniture.length).toBe(Object.keys(FURNITURE).length);
    expect(shops.furniture.every((l) => l.kind === 'furniture')).toBe(true);
  });
});

describe('arranging the room', () => {
  it('enters through its own door onto the welcome mat', () => {
    const { world, id, p } = fresh();
    const res = world.loop(id, { action: 'house.enter' }) as unknown as { ok: boolean; layout: { items: unknown[] }; of: string; owned: Record<string, number> };
    expect(res.ok).toBe(true);
    expect(res.of).toBe(p.saveKey);
    expect(res.layout.items).toEqual([]);
    expect(res.owned.cot).toBe(1);
    expect(p.place).toBe('house');
    expect(p.houseOf).toBe(p.saveKey);
    expect([p.x, p.y]).toEqual([HOUSE_SPAWN.x, HOUSE_SPAWN.z]);
  });

  it('puts down, turns and picks up what it owns', () => {
    const { world, id, token } = fresh();
    world.loop(id, { action: 'house.enter' });
    const down = world.loop(id, { action: 'house.place', fid: 'cot', x: -4, z: -2, rot: 0 }) as unknown as { ok: boolean; layout: { items: { uid: string; rot: number }[] } };
    expect(down.ok).toBe(true);
    const uid = down.layout.items[0]!.uid;
    const turned = world.loop(id, { action: 'house.rotate', uid }) as unknown as { ok: boolean; layout: { items: { rot: number }[] } };
    expect(turned.ok).toBe(true);
    expect(turned.layout.items[0]!.rot).toBe(1);
    const up = world.loop(id, { action: 'house.pickup', uid }) as unknown as { ok: boolean; layout: { items: unknown[] } };
    expect(up.ok).toBe(true);
    expect(up.layout.items).toEqual([]);
    expect(world.profiles.houseOf(token).layout.items).toEqual([]);
  });

  it('refuses bad coordinates even from the host', () => {
    const { world, id } = fresh();
    world.loop(id, { action: 'house.enter' });
    expect(world.loop(id, { action: 'house.place', fid: 'cot', x: 0, z: 4, rot: 0 }).ok).toBe(false);
    expect(world.loop(id, { action: 'house.place', fid: 'throne', x: -4, z: -2, rot: 0 }).ok).toBe(false);
    expect(world.loop(id, { action: 'house.rotate', uid: 'nope' }).ok).toBe(false);
  });

  it('leaves back out the door where the street was parked', () => {
    const { world, id, p } = fresh();
    const at = { x: p.x, y: p.y };
    world.loop(id, { action: 'house.enter' });
    expect(world.loop(id, { action: 'house.leave' }).ok).toBe(true);
    expect(p.place).toBe('street');
    expect(p.houseOf).toBeNull();
    expect([p.x, p.y]).toEqual([at.x, at.y]);
    expect(world.loop(id, { action: 'house.leave' }).ok).toBe(false);
  });
});

describe('calling a friend over', () => {
  it('walks an invited guest in, and only the host arranges the room', () => {
    const { world, id: hostId, p: host } = fresh(4001);
    const { id: guestId, p: guest } = joinAs(world, 4002);
    const pushes: Record<string, unknown>[] = [];
    world.onPush(guestId, (m) => pushes.push(m));
    expect(world.loop(hostId, { action: 'house.invite', with: guestId }).ok).toBe(true);
    expect(pushes.some((m) => (m as { invite?: unknown }).invite)).toBe(true);
    const entered = world.loop(guestId, { action: 'house.accept' }) as unknown as { ok: boolean; layout: unknown; of: string; owned?: unknown };
    expect(entered.ok).toBe(true);
    expect(entered.of).toBe(host.saveKey);
    expect(entered.owned).toBeUndefined();
    expect(guest.place).toBe('house');
    expect(guest.houseOf).toBe(host.saveKey);
    // The guest's hands are tied, however perfect the coordinates.
    expect(world.loop(guestId, { action: 'house.place', fid: 'cot', x: -4, z: -2, rot: 0 }).ok).toBe(false);
    world.loop(hostId, { action: 'house.enter' });
    world.loop(hostId, { action: 'house.place', fid: 'cot', x: -4, z: -2, rot: 0 });
    const uid = world.profiles.houseOf(host.tokenId).layout.items[0]!.uid;
    expect(world.loop(guestId, { action: 'house.rotate', uid }).ok).toBe(false);
    expect(world.loop(guestId, { action: 'house.pickup', uid }).ok).toBe(false);
  });

  it('tells the host a decline, and forgets an expired invitation', () => {
    const { world, id: hostId } = fresh(4001);
    const { id: guestId } = joinAs(world, 4002);
    const notes: Record<string, unknown>[] = [];
    world.onPush(hostId, (m) => notes.push(m));
    world.loop(hostId, { action: 'house.invite', with: guestId });
    expect(world.loop(guestId, { action: 'house.decline' }).ok).toBe(true);
    expect(notes.some((m) => String((m as { notice?: string }).notice ?? '').includes('declined'))).toBe(true);
    expect(world.loop(guestId, { action: 'house.accept' }).ok).toBe(false);
    expect(world.loop(hostId, { action: 'house.invite', with: 'nobody' }).ok).toBe(false);
  });

  it('pushes the new room to everyone inside when the host edits', () => {
    const { world, id: hostId } = fresh(4011);
    const { id: guestId } = joinAs(world, 4012);
    const seen: Record<string, unknown>[] = [];
    world.onPush(guestId, (m) => seen.push(m));
    world.loop(hostId, { action: 'house.enter' });
    world.loop(hostId, { action: 'house.invite', with: guestId });
    world.loop(guestId, { action: 'house.accept' });
    world.loop(hostId, { action: 'house.place', fid: 'rug', x: -3, z: -3, rot: 0 });
    const layouts = seen.filter((m) => (m as { layout?: unknown }).layout) as { layout: { items: { fid: string }[] } }[];
    expect(layouts.length).toBeGreaterThan(0);
    expect(layouts[layouts.length - 1]!.layout.items).toEqual([
      expect.objectContaining({ fid: 'rug' }),
    ]);
  });

  it('shows housemates to each other and to nobody on the street', () => {
    const { world, id: hostId } = fresh(4001);
    const { id: guestId } = joinAs(world, 4002);
    const { id: streetId } = joinAs(world, 4003);
    world.loop(hostId, { action: 'house.enter' });
    world.loop(hostId, { action: 'house.invite', with: guestId });
    world.loop(guestId, { action: 'house.accept' });
    const guestSees = world.snapshot(guestId).players.map((p) => p.id);
    expect(guestSees).toContain(hostId);
    const streetSees = world.snapshot(streetId).players.map((p) => p.id);
    expect(streetSees).not.toContain(hostId);
    expect(streetSees).not.toContain(guestId);
  });

  it('opens nothing for a bare move naming a house with no host', () => {
    const { world, id, p } = fresh();
    world.move(id, { place: 'house' });
    expect(p.place).toBe('street');
    expect(p.houseOf).toBeNull();
  });
});
