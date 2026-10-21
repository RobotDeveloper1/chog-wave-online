/** Dumps what every node of every fold actually holds: node tools/dump-dungeons.mjs */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Kauker/.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core/index.js');

const browser = await chromium.launch({
  executablePath: 'C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
  args: ['--no-proxy-server', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] ?? 'http://localhost:5174/dungeon-sheet.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 45000 });
  console.log(await page.evaluate(() => window.__dump));
} finally {
  await browser.close();
}
