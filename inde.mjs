
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const URL = 'https://lessons.antischool.online/materials/019fd3a5-4216-7963-8f74-6ce0aa472d7c';
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const log = [];
page.on('response', async (r) => {
  const ct = r.headers()['content-type'] || '';
  const u = r.url();
  if (/json|mpegurl|video|mp4/.test(ct) || /\.(m3u8|mp4|mpd)/.test(u)) {
    log.push({ url: u, status: r.status(), type: ct });
    if (ct.includes('json')) {
      try { await fs.appendFile('api-dump.jsonl', JSON.stringify({ u, body: await r.json() }) + '\n'); } catch {}
    }
  }
});

await page.goto(URL);
console.log('Залогинься в окне браузера, дождись загрузки материала и нажми Enter здесь');
await new Promise((res) => process.stdin.once('data', res));
await page.waitForLoadState('networkidle');

await fs.writeFile('page.html', await page.content());
await page.screenshot({ path: 'page.png', fullPage: true });
await fs.writeFile('network.json', JSON.stringify(log, null, 2));
await ctx.storageState({ path: 'state.json' });
await browser.close();