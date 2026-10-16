(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const shuffle = (a) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  };
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  const themeBtn = $('#theme');
  if (themeBtn) themeBtn.onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    store.set('theme', root.dataset.theme);
  };

  const tn = $('#tn');
  if (tn) {
    const apply = () => document.body.classList.toggle('hide-teacher', !tn.checked);
    tn.checked = store.get('teacherNotes') !== '0';
    apply();
    tn.onchange = () => { store.set('teacherNotes', tn.checked ? '1' : '0'); apply(); };
  }

  const q = $('#q');
  if (q) q.oninput = () => {
    const t = norm(q.value);
    $$('.group').forEach((g) => {
      let hits = 0;
      $$('li', g).forEach((li) => {
        const ok = !t || norm(li.textContent).includes(t);
        li.style.display = ok ? '' : 'none';
        if (ok) hits++;
      });
      g.style.display = hits ? '' : 'none';
      g.open = true;
    });
  };

  $$('.check input').forEach((cb, i) => {
    const key = `chk:${location.pathname}:${i}`;
    cb.checked = store.get(key) === '1';
    cb.onchange = () => store.set(key, cb.checked ? '1' : '0');
  });

  const lb = document.createElement('div');
  lb.id = 'lb';
  document.body.append(lb);
  lb.onclick = () => lb.classList.remove('on');
  $$('main img').forEach((img) => {
    img.style.cursor = 'zoom-in';
    img.onclick = () => { lb.innerHTML = ''; const c = document.createElement('img'); c.src = img.src; lb.append(c); lb.classList.add('on'); };
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('on'); });

  $$('.say').forEach((b) => b.onclick = () => {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(b.dataset.w);
    u.lang = 'en-US';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });

  const links = $$('.toc a');
  if (links.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
    }), { rootMargin: '-20% 0px -70% 0px' });
    $$('section[id]').forEach((s) => io.observe(s));
  }

  function ctl(ex, { check, show, reset }) {
    const d = document.createElement('div');
    d.className = 'ctl';
    const mk = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.onclick = f; d.append(b); };
    if (check) mk('Check', check);
    if (show) mk('Show answers', show);
    if (reset) mk('Reset', reset);
    ex.append(d);
  }

  $$('[data-ex=choose]').forEach((ex) => {
    ex.addEventListener('click', (e) => {
      const b = e.target.closest('.opt');
      if (!b || ex.classList.contains('done')) return;
      ex.classList.add('done');
      $$('.opt', ex).forEach((o) => { if (o.dataset.ok === '1') o.classList.add('ok'); });
      if (b.dataset.ok !== '1') b.classList.add('bad');
    });
    ctl(ex, {
      reset: () => { ex.classList.remove('done'); $$('.opt', ex).forEach((o) => o.classList.remove('ok', 'bad')); },
    });
  });

  $$('[data-ex=order]').forEach((ex) => {
    const items = JSON.parse(ex.dataset.items);
    const pool = $('.pool', ex), ans = $('.ans', ex);
    const chip = (t, i) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = t; b.dataset.i = i;
      b.onclick = () => { (b.parentNode === pool ? ans : pool).append(b); ex.classList.remove('good', 'wrong'); };
      return b;
    };
    const init = () => {
      pool.innerHTML = ''; ans.innerHTML = ''; ex.classList.remove('good', 'wrong');
      let sh = shuffle(items.map((t, i) => ({ t, i })));
      if (items.length > 1) while (sh.every((x, k) => x.i === k)) sh = shuffle(sh);
      sh.forEach((x) => pool.append(chip(x.t, x.i)));
    };
    init();
    ctl(ex, {
      check: () => {
        const got = $$('.chip', ans).map((c) => +c.dataset.i);
        const ok = got.length === items.length && got.every((v, k) => v === k);
        ex.classList.toggle('good', ok); ex.classList.toggle('wrong', !ok);
      },
      show: () => {
        init();
        $$('.chip', pool).sort((a, b) => a.dataset.i - b.dataset.i).forEach((c) => ans.append(c));
        ex.classList.add('good');
      },
      reset: init,
    });
  });

  $$('[data-ex=match]').forEach((ex) => {
    const sels = $$('select', ex);
    ctl(ex, {
      check: () => sels.forEach((s) => {
        s.classList.toggle('ok', s.value === s.dataset.a);
        s.classList.toggle('bad', s.value !== s.dataset.a);
      }),
      show: () => sels.forEach((s) => { s.value = s.dataset.a; s.classList.add('ok'); s.classList.remove('bad'); }),
      reset: () => sels.forEach((s) => { s.value = ''; s.classList.remove('ok', 'bad'); }),
    });
  });

  $$('[data-ex=gaps], [data-ex=unscramble]').forEach((ex) => {
    $$('.scr', ex).forEach((el) => {
      const w = el.dataset.w;
      let s = w;
      for (let i = 0; i < 20 && s === w && w.length > 1; i++) s = shuffle([...w]).join('');
      el.textContent = s;
    });
    const gaps = $$('.gap', ex);
    ctl(ex, {
      check: () => gaps.forEach((g) => {
        const ok = norm(g.value) === norm(g.dataset.a);
        g.classList.toggle('ok', ok); g.classList.toggle('bad', !ok);
      }),
      show: () => gaps.forEach((g) => { g.value = g.dataset.a; g.classList.add('ok'); g.classList.remove('bad'); }),
      reset: () => gaps.forEach((g) => { g.value = ''; g.classList.remove('ok', 'bad'); }),
    });
  });
})();
