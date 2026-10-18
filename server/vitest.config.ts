import { defineConfig } from 'vitest/config';

/**
 * The server's suites drive real time.
 *
 * A duel fixture runs the field clock in 50 ms slices, a dungeon fixture walks a run through the
 * profile store, and a chat fixture waits on sockets — so a test that measures ~0.5 s on an idle
 * machine measures ~6 s when the machine is also running the game server, the dev server and a
 * headless browser, which is exactly the state a developer's machine is in. Vitest's 5 s default
 * turns that load into red tests that say nothing about the code.
 *
 * The default is raised rather than per-test: a fixture that hangs should still fail, and 20 s
 * fails it. What it must not do is fail a test that merely had to wait its turn.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
