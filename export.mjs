// export.mjs  (Node 18+, без зависимостей)
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://lessons.antischool.online/api/v1';
const MATERIAL = '019fd3a5-4216-7963-8f74-6ce0aa472d7c';
const OUT = process.env.VAULT_DIR || './vault/CEFR Adults';
const LIMIT = Number(process.env.LIMIT || 0);          // LIMIT=3 для пробного прогона

const safe = (s) => s.replace(/[\\/:*?"<>|#^\[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
const pad = (n) => String(n + 1).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_KEY = /(file|image|img|audio|video|picture|photo|media|src|poster|cover)/i;
const SKIP_KEY = /^(id|type|kind|createdAt|updatedAt|orderIndex|order|version|materialId|groupId|lessonId|status|w|h|width|height)$/i;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'audio/ogg': 'ogg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf' };

let token = '', cookie = '';

async function login() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.SITE_EMAIL, password: process.env.SITE_PASS }),
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  token = (await r.json()).accessToken;
  cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function raw(p, retry = true) {
  const r = await fetch(BASE + p, { headers: { authorization: `Bearer ${token}`, cookie } });
  if (r.status === 401 && retry) { await login(); return raw(p, false); }   // токен живёт 15 мин
  return r;
}
async function api(p) {
  const r = await raw(p);
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}

// ---------- список уроков (параметр пагинации неизвестен, пробуем варианты) ----------
async function allLessons(groups) {
  const byId = new Map();
  const add = (items) => items.forEach((l) => byId.set(l.id, l));
  add((await api(`/materials/${MATERIAL}/lessons?limit=200`)).items);
  for (const key of ['offset', 'skip']) {
    if (byId.size >= 516) break;
    for (let o = 200; o < 2000; o += 200) {
      const before = byId.size;
      try { add((await api(`/materials/${MATERIAL}/lessons?limit=200&${key}=${o}`)).items); } catch { break; }
      if (byId.size === before) break;
    }
  }
  if (byId.size < 516) {                                    // запасной вариант: по группам
    for (const g of groups) {
      try { add((await api(`/materials/${MATERIAL}/lessons?limit=200&groupId=${g.id}`)).items); } catch {}
    }
  }
  return [...byId.values()];
}

// ---------- файлы ----------
async function downloadFile(id, assetsDir) {
  for (const ext of Object.values(EXT)) {                   // уже скачан?
    try { await fs.access(path.join(assetsDir, `${id}.${ext}`)); return `${id}.${ext}`; } catch {}
  }
  const r = await raw(`/files/${id}`);
  if (!r.ok) return null;
  const ct = (r.headers.get('content-type') || '').split(';')[0];
  const name = `${id}.${EXT[ct] || 'bin'}`;
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, name), Buffer.from(await r.arrayBuffer()));
  return name;
}

const htmlToText = (s) => s
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
  .replace(/<li>/gi, '- ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();

// ---------- JSON -> markdown (универсальный обход) ----------
async function render(node, key, ctx, depth = 0) {
  const lines = [];
  if (node == null) return lines;
  if (typeof node === 'string') {
    const s = node.trim();
    if (!s) return lines;
    if (UUID.test(s)) {
      if (FILE_KEY.test(key)) {
        const name = await downloadFile(s, ctx.assetsDir);
        if (name) lines.push(`![[${name}]]`);
      }
      return lines;
    }
    if (/^https?:\/\//.test(s)) {
      lines.push(`[${key || 'link'}](${s})`);
      if (/youtu|vimeo|wistia|\.m3u8|\.mp4|loom|drive\.google/.test(s)) ctx.videos.push(s);
      return lines;
    }
    if (SKIP_KEY.test(key)) return lines;
    lines.push(/<[a-z][\s\S]*>/i.test(s) ? htmlToText(s) : s);
    return lines;
  }
  if (typeof node !== 'object') return lines;
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) lines.push(...(await render(v, key, ctx, depth)));
    return lines;
  }
  if (typeof node.type === 'string' && depth <= 3) lines.push('', `${'#'.repeat(Math.min(depth + 2, 5))} ${node.type}`);
  for (const [k, v] of Object.entries(node)) {
    const sub = await render(v, k, ctx, depth + 1);
    if (!sub.length) continue;
    const isTextual = typeof v === 'string' && !sub[0].startsWith('![[') && !sub[0].startsWith('[');
    if (isTextual && !/^(text|title|html|content|body|description|caption|name)$/i.test(k)) {
      lines.push(`**${k}:** ${sub.join('\n')}`);
    } else lines.push(...sub);
  }
  return lines;
}

// ---------- main ----------
await login();
const { items: groups } = await api(`/materials/${MATERIAL}/lesson-groups`);
const lessons = await allLessons(groups);
console.log(`Групп: ${groups.length}, уроков: ${lessons.length} (ожидается 516)`);

let done = 0;
const videos = [];
await fs.mkdir(path.join(OUT, '_raw'), { recursive: true });

for (const [gi, g] of groups.entries()) {
  const dir = path.join(OUT, `${pad(gi)} ${safe(g.title)}`);
  await fs.mkdir(dir, { recursive: true });
  const list = lessons.filter((l) => l.groupId === g.id).sort((a, b) => a.orderIndex - b.orderIndex);
  for (const l of list) {
    if (LIMIT && done >= LIMIT) process.exit(0);
    const file = path.join(dir, `${pad(l.orderIndex)} ${safe(l.title)}.md`);
    try { await fs.access(file); continue; } catch {}
    try {
      const data = await api(`/mat-lessons/${l.id}`);
      await fs.writeFile(path.join(OUT, '_raw', `${l.id}.json`), JSON.stringify(data, null, 2));
      const ctx = { assetsDir: path.join(dir, 'assets'), videos: [] };
      const body = (await render(data, '', ctx)).join('\n\n');
      ctx.videos.forEach((v) => videos.push(`${v}\t${l.title}`));
      await fs.writeFile(file, `---\ngroup: "${g.title}"\nlessonId: ${l.id}\n---\n# ${l.title}\n\n${body}\n`);
      console.log('✓', path.relative(OUT, file));
      done++;
    } catch (e) { console.warn('✗', l.title, e.message); }
    await sleep(300);
  }
}
if (videos.length) await fs.appendFile(path.join(OUT, 'videos.txt'), videos.join('\n') + '\n');