/**
 * Who you know, by token.
 *
 * A personal contact book, kept in the browser. It is deliberately NOT a social graph on the
 * server: nobody should have to accept a friend request for a marker that only helps *you* find
 * them on a crowded street, and a list that lives with you survives a server wipe. The party
 * invite and the whisper are the real social verbs — this is just the label over them.
 */

const KEY = 'chog.friends.v1';

const load = (): number[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

let known = new Set(load());
let listeners: (() => void)[] = [];

const save = (): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify([...known]));
  } catch {
    /* private browsing: the list simply does not survive the session */
  }
  for (const fn of listeners) fn();
};

export const friends = {
  has: (token: number): boolean => known.has(token),
  all: (): number[] => [...known],
  /** Add or drop a friend. Returns what the token is NOW, so a caller can say the right thing. */
  toggle: (token: number): boolean => {
    if (known.has(token)) known.delete(token);
    else known.add(token);
    save();
    return known.has(token);
  },
  onChange: (fn: () => void): void => {
    listeners.push(fn);
  },
};
