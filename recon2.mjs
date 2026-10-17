
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ storageState: 'state.json' });
const page = await ctx.newPage();
const seen = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('antischool')) return;
  const ct = r.headers()['content-type'] || '';
  seen.push({ u, status: r.status(), ct });
  if (ct.includes('json') && /lesson|block|file|media/.test(u)) {
    try { await fs.appendFile('lesson-dump.jsonl', JSON.stringify({ u, body: await r.json() }) + '\n'); } catch {}
  }
});
await page.goto('https://lessons.antischool.online/materials/019fd3a5-4216-7963-8f74-6ce0aa472d7c'); // 019fd82b-d7fb-7d58-97a8-26f8fdd314af
console.log('Открой урок с видео и картинками, пролистай до конца, нажми Enter');
await new Promise((r) => process.stdin.once('data', r));
await fs.writeFile('lesson-network.json', JSON.stringify(seen, null, 2));
await browser.close();