
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.VAULT_DIR || './vault/CEFR';


const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = encodeURIComponent;
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const j = (o) => esc(JSON.stringify(o));
const KEY = /^\*\*(\w+):\*\* ?([\s\S]*)$/;
const IMG = /^!\[\[(.+?)\]\]$/;
const LINK = /^\[[^\]]*\]\((https?:[^)]+)\)$/;
const isMarker = (p) => /^\p{Extended_Pictographic}/u.test(p) && !p.includes('\n') && p.length <= 30;

function rich(t) {
  let out = '', list = false;
  for (const raw of t.split('\n')) {
    const l = raw.trimEnd();
    const li = l.match(/^\s*[-•]\s+(.*)$/);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

function media(name) {
  const ext = name.split('.').pop().toLowerCase();
  const src = 'assets/' + enc(name);
  if (['mp3', 'm4a', 'wav', 'ogg'].includes(ext)) return `<audio controls preload="none" src="${src}"></audio>`;
  if (['mp4', 'webm'].includes(ext)) return `<video controls preload="metadata" src="${src}"></video>`;
  if (['pdf', 'bin'].includes(ext)) return `<a class="file" href="${src}" target="_blank">📎 ${esc(name)}</a>`;
  return `<img loading="lazy" src="${src}" alt="">`;
}

function embed(url) {
  const yt = url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
  if (yt) return `<div class="video"><iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `<div class="video"><iframe src="https://player.vimeo.com/video/${vm[1]}" allowfullscreen></iframe></div>`;
  return `<p><a class="file" href="${esc(url)}" target="_blank" rel="noopener">🔗 ${esc(url)}</a></p>`;
}


function loose(paras) {
  return paras.map((p) => {
    let m;
    if ((m = p.match(IMG))) return media(m[1]);
    if ((m = p.match(LINK))) return embed(m[1]);
    return rich(p);
  }).join('');
}


function parseLesson(src) {
  src = src.replace(/\r\n/g, '\n');
  const fm = {};
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (m) {
    for (const l of m[1].split('\n')) {
      const i = l.indexOf(':');
      if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
    }
    src = src.slice(m[0].length);
  }
  const t = src.match(/^# (.*)\n/);
  const title = t ? t[1] : 'Untitled';
  if (t) src = src.slice(t[0].length);
  src = src.replace(/\n+\*\*myAccess:\*\* \w+\s*$/, '\n');

  const parts = src.split(/^#### (\w+)[ \t]*$/m);
  const blocks = [];
  for (let i = 1; i < parts.length; i += 2) blocks.push({ type: parts[i], body: parts[i + 1] || '' });
  return { fm, title, pre: parts[0], blocks };
}

function parseBody(body) {
  const paras = body.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let marker = null;
  if (paras.length >= 2 && isMarker(paras[paras.length - 1])) marker = paras.pop();
  const items = [];
  for (let i = 0; i < paras.length; i++) {
    const km = paras[i].match(KEY);
    if (km) {
      if (km[1] === 'script') { items.push({ k: 'script', v: [km[2], ...paras.slice(i + 1)].join('\n\n') }); break; }
      items.push({ k: km[1], v: km[2] });
    } else items.push({ k: null, v: paras[i] });
  }
  return { items, marker };
}


function gapsHtml(src, box) {
  const lines = src.split('\n').filter((l) => l.trim());
  const answers = [];
  const rows = lines.map((l) => {
    let out = '', last = 0;
    l.replace(/\[([^\]]+)\]/g, (mm, a, idx) => {
      out += esc(l.slice(last, idx));
      answers.push(a);
      out += box
        ? `<select class="gap" data-a="${esc(a)}">@@BANK@@</select>`
        : `<input class="gap" data-a="${esc(a)}" size="${Math.max(a.length + 1, 3)}" autocomplete="off" spellcheck="false">`;
      last = idx + mm.length;
      return mm;
    });
    return `<div class="gline">${out + esc(l.slice(last))}</div>`;
  });
  let html = rows.join('');
  if (box) {
    const bank = '<option value="">…</option>' + [...new Set(answers)].sort().map((a) => `<option>${esc(a)}</option>`).join('');
    html = html.replaceAll('@@BANK@@', bank);
  }
  return html;
}

function renderBlock(type, items) {
  const get = (k) => items.find((i) => i.k === k)?.v;
  const body = items.filter((i) => i.k === null).map((i) => i.v);
  const instr = get('instruction');
  const head = instr ? `<div class="instr">${inline(instr)}</div>` : '';

  switch (type) {
    case 'note': {
      const heading = get('heading');
      const teacher = /teacher|вчител/i.test(heading || '');
      return `<div class="blk note ${teacher ? 'teacher' : ''}">${heading ? `<div class="bh">${esc(heading)}</div>` : ''}${loose(body)}</div>`;
    }
    case 'article': {
      const heading = get('heading');
      return `<div class="blk article">${heading ? `<h3>${esc(heading)}</h3>` : ''}${loose(body)}</div>`;
    }
    case 'test': {
      const [h, ...rest] = body;
      return `<div class="blk test"><div class="bh">${inline(h || '')}</div><ul class="check">${rest
        .map((x) => `<li><label><input type="checkbox"><span>${inline(x)}</span></label></li>`).join('')}</ul></div>`;
    }
    case 'pictures': {
      const figs = []; let lead = [];
      for (const p of body) {
        if (IMG.test(p)) figs.push({ img: p.match(IMG)[1], caps: [] });
        else if (figs.length) figs[figs.length - 1].caps.push(p);
        else lead.push(p);
      }
      return `<div class="blk pics">${head}${loose(lead)}<div class="grid">${figs
        .map((f) => `<figure>${media(f.img)}${f.caps.length ? `<figcaption>${rich(f.caps.join('\n'))}</figcaption>` : ''}</figure>`).join('')}</div></div>`;
    }
    case 'audio': {
      const file = body.find((p) => IMG.test(p));
      const script = get('script');
      return `<div class="blk audio">${head}${file ? media(file.match(IMG)[1]) : ''}${script
        ? `<details class="script"><summary>Script</summary>${rich(script)}</details>` : ''}</div>`;
    }
    case 'choose_option': {
      const spec = [...body].reverse().find((p) => /^\[[\s\S]*\]$/.test(p) && p.includes('/'));
      if (!spec) break;
      const opts = spec.slice(1, -1).split('/').map((o) => ({ t: o.replace(/\*$/, '').trim(), ok: o.trim().endsWith('*') }));
      const set = new Set(opts.map((o) => o.t));
      const q = body.filter((p) => p !== spec && !set.has(p) && !IMG.test(p));
      return `<div class="blk ex" data-ex="choose">${head}${q.length ? `<div class="q">${loose(q)}</div>` : ''}<div class="opts">${opts
        .map((o) => `<button class="opt" data-ok="${o.ok ? 1 : 0}">${esc(o.t)}</button>`).join('')}</div></div>`;
    }
    case 'text_order':
      return `<div class="blk ex" data-ex="order" data-items="${j(body)}">${head}<div class="ans"></div><div class="pool"></div></div>`;
    case 'match': {
      const pairs = [];
      for (const it of items) {
        if (it.k === null) pairs.push({ l: it.v, r: '' });
        else if (it.k === 'right' && pairs.length) pairs[pairs.length - 1].r = it.v;
      }
      const rights = [...new Set(pairs.map((p) => p.r))].sort();
      const optsHtml = '<option value="">…</option>' + rights.map((r) => `<option>${esc(r)}</option>`).join('');
      return `<div class="blk ex" data-ex="match">${head}${pairs
        .map((p) => `<div class="mrow"><span class="l">${inline(p.l)}</span><select data-a="${esc(p.r)}">${optsHtml}</select></div>`).join('')}</div>`;
    }
    case 'fill_gaps':
    case 'fill_gaps_box': {
      const srcP = [...body].reverse().find((p) => /\[[^\]]+\]/.test(p));
      if (!srcP) break;
      return `<div class="blk ex" data-ex="gaps">${head}${gapsHtml(srcP, type === 'fill_gaps_box')}</div>`;
    }
    case 'wordlist': {
      const rows = [];
      for (const it of items) {
        if (it.k === 'word') rows.push({ w: it.v, t: '' });
        else if (it.k === 'translation' && rows.length) rows[rows.length - 1].t = it.v;
      }
      return `<div class="blk words">${head}<table>${rows
        .map((r) => `<tr><td class="w"><button class="say" data-w="${esc(r.w)}" title="Listen">🔊</button> ${esc(r.w)}</td><td class="t">${esc(r.t)}</td></tr>`).join('')}</table></div>`;
    }
    case 'unscramble': {
      const words = items.filter((i) => i.k === 'word').map((i) => i.v);
      return `<div class="blk ex" data-ex="unscramble">${head}${words
        .map((w) => `<div class="urow"><span class="scr" data-w="${esc(w)}"></span><input class="gap" data-a="${esc(w)}" size="${w.length + 2}" autocomplete="off" spellcheck="false"></div>`).join('')}</div>`;
    }
    default:
      break;
  }
  const extra = items.filter((i) => i.k && !['instruction', 'layout', 'instructionPos', 'mode', 'color'].includes(i.k))
    .map((i) => `<div class="kv"><span>${esc(i.k)}</span> ${inline(i.v)}</div>`).join('');
  return `<div class="blk generic"><div class="tag">${esc(type)}</div>${head}${loose(body)}${extra}</div>`;
}


function renderLesson(parsed) {
  const sections = [];
  let cur = { title: null, html: [] };
  const flush = () => { if (cur.html.length) sections.push(cur); };
  for (const p of parsed.pre.trim().split(/\n{2,}/).map((x) => x.trim())) {
    if (isMarker(p)) cur.title = p;
  }
  for (const b of parsed.blocks) {
    const { items, marker } = parseBody(b.body);
    cur.html.push(renderBlock(b.type, items));
    if (marker) { flush(); cur = { title: marker, html: [] }; }
  }
  flush();
  return sections;
}

const CSS_LINK = (rel) => `<link rel="stylesheet" href="${rel}viewer.css"><script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>`;

function lessonPage(parsed, groupTitle, prev, next) {
  const sections = renderLesson(parsed);
  const toc = sections.map((s, i) => `<a href="#s${i}">${esc(s.title || 'Start')}</a>`).join('');
  const body = sections.map((s, i) => `<section id="s${i}">${s.title ? `<h2>${esc(s.title)}</h2>` : ''}${s.html.join('')}</section>`).join('');
  const nav = `<nav class="pn">${prev ? `<a href="${prev.href}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.href}">${esc(next.title)} →</a>` : '<span></span>'}</nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(parsed.title)}</title>${CSS_LINK('../')}</head>
<body class="lesson"><header class="top"><a href="../index.html">All lessons</a><span class="grp">${esc(groupTitle)}</span><span class="tools"><label><input type="checkbox" id="tn" checked> Teacher notes</label><button id="theme" title="Theme">◐</button></span></header>
<div class="layout"><aside class="toc">${toc}</aside><main><h1>${esc(parsed.title)}</h1>${body}${nav}</main></div>
<script src="../viewer.js"></script></body></html>`;
}

const dirs = (await fs.readdir(ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'assets')
  .map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const groups = [];
let total = 0;
for (const dir of dirs) {
  const files = (await fs.readdir(path.join(ROOT, dir))).filter((f) => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) continue;
  const lessons = [];
  for (const f of files) {
    const parsed = parseLesson(await fs.readFile(path.join(ROOT, dir, f), 'utf8'));
    lessons.push({ f, parsed, html: f.replace(/\.md$/, '.html') });
  }
  groups.push({ dir, title: lessons[0].parsed.fm.group || dir.replace(/^\d+\s*/, ''), lessons });
}

for (const g of groups) {
  for (const [i, l] of g.lessons.entries()) {
    const link = (x) => x && { href: enc(x.html), title: x.parsed.title };
    const page = lessonPage(l.parsed, g.title, link(g.lessons[i - 1]), link(g.lessons[i + 1]));
    await fs.writeFile(path.join(ROOT, g.dir, l.html), page);
    total++;
  }
}

const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CEFR Adults</title>${CSS_LINK('')}</head>
<body class="home"><header class="top"><strong>CEFR Adults</strong><span class="grp">${total} lessons</span><span class="tools"><button id="theme" title="Theme">◐</button></span></header>
<main><input id="q" type="search" placeholder="Search lessons…" autocomplete="off">
${groups.map((g) => `<details class="group" open><summary>${esc(g.title)} <small>${g.lessons.length}</small></summary><ul class="lessons">${g.lessons
  .map((l) => `<li><a href="${enc(g.dir)}/${enc(l.html)}">${esc(l.parsed.title)}</a></li>`).join('')}</ul></details>`).join('\n')}
</main><script src="viewer.js"></script></body></html>`;
await fs.writeFile(path.join(ROOT, 'index.html'), index);

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['viewer.css', 'viewer.js']) await fs.copyFile(path.join(here, f), path.join(ROOT, f));

console.log(`Готово: ${total} уроков в ${groups.length} группах.`);
console.log(`Открой: ${path.resolve(ROOT, 'index.html')}`);
