/* CourseWise study site: questions, summaries and flashcards per lecture.
   Plain JavaScript, no libraries, no network requests except this site's own files.

   Data      data/registry.json lists one file per lecture; a lecture file holds
             {module, discipline, title, covers, summary[], cards[], questions[]}.
   Progress  saved in this browser's localStorage (keys start with "qbank.v2."). Nothing is sent anywhere.
   Addresses #/m/<module>/<discipline>/<lecture>[/summary|/cards]  (slugs made from titles, no lecture numbers)
   Styles    the page's Content-Security-Policy blocks inline style attributes; widths are written as data-w="…" and applied in render()

   Sections of this file: storage · data · helpers · router · pages · quiz · flashcards · other pages · keys/offline · start */
'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const enc = encodeURIComponent, LET = 'ABCDE';
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const main = $('#main');

/* ---------- storage ---------- */
const K = {prog: 'qbank.v2.progress', ses: 'qbank.v2.session', cards: 'qbank.v2.cardsession', set: 'qbank.v2.settings'};
let storageOK = true;
function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (e) { storageOK = false; return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { storageOK = false; say('Could not save progress in this browser (storage is blocked or full).'); return false; }
}
/* progress = {a: answers by question id, f: flagged question ids, c: flashcard marks by card id, h: session history} */
const blankProg = () => ({v: 2, a: {}, f: {}, c: {}, h: []});
function cleanProg(p) {
  const out = blankProg();
  if (!p || typeof p !== 'object') return out;
  if (p.a && typeof p.a === 'object') for (const [id, r] of Object.entries(p.a)) {
    if (r && typeof r === 'object' && LET.includes(r.l)) out.a[id] = {l: r.l, ok: r.ok ? 1 : 0, n: +r.n || 1, w: +r.w || 0, t: +r.t || 0};
  }
  if (p.f && typeof p.f === 'object') for (const id of Object.keys(p.f)) if (p.f[id]) out.f[id] = 1;
  if (p.c && typeof p.c === 'object') for (const [id, r] of Object.entries(p.c)) {
    if (r && (r.s === 'known' || r.s === 'again')) out.c[id] = {s: r.s, n: +r.n || 1, t: +r.t || 0};
  }
  if (Array.isArray(p.h)) out.h = p.h.filter(x => x && typeof x === 'object').slice(-60);
  return out;
}
let prog = cleanProg(read(K.prog, null));
let ses = read(K.ses, null);      // current quiz
let cs = read(K.cards, null);     // current flashcard run
let settings = read(K.set, {});
const saveProg = () => write(K.prog, prog);
const saveSes = () => write(K.ses, ses);
const saveCs = () => write(K.cards, cs);
window.addEventListener('storage', e => { if (e.key === K.prog) { prog = cleanProg(read(K.prog, null)); if (!['quiz', 'cards'].includes(route().name)) render(); } });

function say(msg) { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 30); }

/* ---------- data ---------- */
let Q = [], byId = {}, C = [], cardById = {}, LECS = [], loadErrors = [], tree = [], build = {version: '', date: ''};
async function getJSON(url) {
  const r = await fetch(url, {cache: 'no-cache'});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const validQ = q => q && typeof q.id === 'string' && typeof q.stem === 'string' && q.options && typeof q.options === 'object' &&
  typeof q.answer === 'string' && q.options[q.answer] != null;
async function loadData() {
  const reg = await getJSON('data/registry.json');
  build = {version: reg.version || '', date: reg.built || ''};
  const files = (reg.lectures || []).map(f => typeof f === 'string' ? f : f.file);
  let got = null;
  if (reg.bundle) {   // one download instead of one per lecture; made by the build script
    try { const all = await getJSON(reg.bundle); if (Array.isArray(all.lectures) && all.lectures.length === files.length) got = all.lectures.map((d, i) => ({f: files[i], d})); } catch (e) { got = null; }
  }
  if (!got) got = await Promise.all(files.map(f => getJSON(f).then(d => ({f, d}), e => ({f, e}))));
  const B = new Map();
  for (const m of reg.modules || []) B.set(m.name, {name: m.name, title: m.title || m.name, note: m.note || '', slug: slug(m.title || m.name), d: new Map()});
  for (const g of got) {
    const d = g.d;
    if (g.e || !d || !d.module || !d.discipline || !d.title) { loadErrors.push(g.f + (g.e ? ' (' + g.e.message + ')' : ' (needs module, discipline and title)')); continue; }
    if (!B.has(d.module)) B.set(d.module, {name: d.module, title: d.module, note: '', slug: slug(d.module), d: new Map()});
    const b = B.get(d.module);
    if (!b.d.has(d.discipline)) b.d.set(d.discipline, {name: d.discipline, slug: slug(d.discipline), b, l: []});
    const disc = b.d.get(d.discipline);
    const lec = {title: d.title, covers: d.covers || '', slug: slug(d.title), b, d: disc, summary: Array.isArray(d.summary) ? d.summary : [], q: [], all: [], cards: []};
    lec.key = b.slug + '/' + disc.slug + '/' + lec.slug;
    let bad = 0;
    for (const q of Array.isArray(d.questions) ? d.questions : []) {
      if (!validQ(q) || byId[q.id]) { bad++; continue; }
      q.lec = lec; q.style = q.style === 'Step1' ? 'Step1' : 'LAU'; q.explanation = q.explanation || ''; q.source = q.source || '';
      byId[q.id] = q; lec.all.push(q);
    }
    for (const c of Array.isArray(d.cards) ? d.cards : []) {
      if (!c || !c.q || !c.a) { bad++; continue; }
      const card = {id: lec.key + '#' + (c.id || slug(c.q).slice(0, 40)), q: c.q, a: c.a, x: c.x || '', img: c.img || '', lec};
      if (cardById[card.id]) { bad++; continue; }
      cardById[card.id] = card; C.push(card); lec.cards.push(card);
    }
    if (bad) loadErrors.push(g.f + ' (' + bad + ' item(s) skipped: missing fields or duplicate id)');
    disc.l.push(lec); LECS.push(lec);
  }
  tree = [...B.values()].map(b => { b.d = [...b.d.values()]; return b; }).filter(b => b.d.length);
  applySet();
}
/* Question sets: a lecture may flag some questions "hy" (high-yield, short set). The chosen set ('hy' by default, or 'full')
   decides which questions count everywhere: lists, quizzes, stats. Lectures without a short set always use all questions. */
const hasShort = l => l.all.some(q => q.hy);
const setName = () => settings.qset === 'full' ? 'full' : 'hy';
function applySet() {
  const full = setName() === 'full';
  for (const l of LECS) l.q = !full && hasShort(l) ? l.all.filter(q => q.hy) : l.all;
  Q = LECS.flatMap(l => l.q);
}
function setToggle(scope) {
  const lecs = scopeLecs(scope).filter(hasShort);
  if (!lecs.length) return '';
  const nh = lecs.reduce((n, l) => n + l.all.filter(q => q.hy).length, 0), nf = lecs.reduce((n, l) => n + l.all.length, 0), cur = setName();
  return `<div class="setrow" role="group" aria-label="Question set"><span class="mute">Question set</span>
    <button type="button" class="seg${cur === 'hy' ? ' on' : ''}" data-set="hy" aria-pressed="${cur === 'hy'}">High-yield (short) · ${nh}</button>
    <button type="button" class="seg${cur === 'full' ? ' on' : ''}" data-set="full" aria-pressed="${cur === 'full'}">Full · ${nf}</button></div>`;
}
function wireSet() {
  $$('[data-set]').forEach(b => b.onclick = () => { settings.qset = b.dataset.set; write(K.set, settings); applySet(); render(); say(b.dataset.set === 'hy' ? 'High-yield set selected' : 'Full set selected'); });
}
/* a "scope" is {b, d, l}: module, optional discipline, optional lecture (objects from the tree) */
const scopeLecs = s => s.l ? [s.l] : s.d ? s.d.l : s.b ? s.b.d.flatMap(d => d.l) : LECS;
const scopeQs = s => scopeLecs(s).flatMap(l => l.q);
const scopeCards = s => scopeLecs(s).flatMap(l => l.cards);
const scopeName = s => s.l ? s.l.title : s.d ? s.d.name : s.b ? s.b.title : 'All modules';
const qHref = q => '#/q/' + q.lec.key + '/' + (q.lec.all.indexOf(q) + 1);
const href = (b, d, l, tail) => '#/m/' + [b && b.slug, d && d.slug, l && l.slug, tail].filter(Boolean).join('/');
function stats(qs) {
  let done = 0, ok = 0, flag = 0;
  for (const q of qs) { const r = prog.a[q.id]; if (r) { done++; if (r.ok) ok++; } if (prog.f[q.id]) flag++; }
  return {n: qs.length, done, ok, bad: done - ok, flag, left: qs.length - done};
}
function cardStats(cards) {
  let known = 0, again = 0;
  for (const c of cards) { const r = prog.c[c.id]; if (r) { if (r.s === 'known') known++; else again++; } }
  return {n: cards.length, known, again, fresh: cards.length - known - again};
}
const statusFilter = {
  all: () => true,
  unanswered: q => !prog.a[q.id],
  incorrect: q => prog.a[q.id] && !prog.a[q.id].ok,
  flagged: q => !!prog.f[q.id]
};
const cardFilter = {
  all: () => true,
  todo: c => !prog.c[c.id] || prog.c[c.id].s !== 'known',
  again: c => prog.c[c.id] && prog.c[c.id].s === 'again'
};

/* ---------- helpers ---------- */
function bar(st) {
  return `<div class="bar" role="img" aria-label="${st.ok} correct, ${st.bad} incorrect, ${st.left} not answered, of ${st.n}"><i data-w="${100 * st.ok / (st.n || 1)}"></i><i class="w" data-w="${100 * st.bad / (st.n || 1)}"></i></div>`;
}
function statLine(st, cst) {
  let h = st.n ? `<span class="pill">${st.done}/${st.n} questions</span>` : '';
  if (st.done) h += ` <span class="pill ${pct(st.ok, st.done) >= 70 ? 'ok' : 'bad'}">${pct(st.ok, st.done)}%</span>`;
  if (cst && cst.n) h += ` <span class="pill">${cst.known}/${cst.n} cards</span>`;
  if (st.flag) h += ` <span class="pill flag">${st.flag} flagged</span>`;
  return h;
}
function ring(p, label) {
  const tone = p >= 70 ? 'good' : p >= 50 ? 'mid' : 'low';
  return `<svg class="ring ${tone}" viewBox="0 0 120 120" role="img" aria-label="${esc(label)} ${p}%"><circle class="t" cx="60" cy="60" r="52"/><circle class="v" cx="60" cy="60" r="52" pathLength="100" data-ring="${p}"/><text x="60" y="68" text-anchor="middle">${p}%</text></svg>`;
}
function kpis(st) {
  return `<div class="kpis"><div><b>${st.n}</b>questions</div><div><b>${st.done}</b>answered</div><div><b>${st.done ? pct(st.ok, st.done) + '%' : '–'}</b>accuracy</div>${st.bad ? `<div><b>${st.bad}</b>to fix</div>` : ''}${st.flag ? `<div><b>${st.flag}</b>flagged</div>` : ''}</div>`;
}
function fmtExp(s) {
  // "Why the answer is right. A: why A is wrong. B, C: ..." -> paragraph + one line per wrong option
  const re = /(?:^|\s)((?:[A-E], )*[A-E]): /g, cuts = [];
  let m; while ((m = re.exec(s))) cuts.push({at: m.index, labEnd: re.lastIndex, lab: m[1]});
  if (!cuts.length) return `<p>${esc(s)}</p>`;
  let html = `<p>${esc(s.slice(0, cuts[0].at))}</p><ul>`;
  cuts.forEach((c, i) => { html += `<li><b>${c.lab}:</b> ${esc(s.slice(c.labEnd, i + 1 < cuts.length ? cuts[i + 1].at : s.length))}</li>`; });
  return html + '</ul>';
}
function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], {type: 'application/json'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const dlg = $('#dlg');
function ask(title, bodyHTML, yes = 'OK', danger = false) {
  if (!dlg.showModal) return Promise.resolve(window.confirm(title));
  $('#dlgT').textContent = title; $('#dlgB').innerHTML = bodyHTML || '';
  const y = $('#dlgYes'), n = $('#dlgNo'); y.textContent = yes; y.classList.toggle('danger', danger);
  return new Promise(res => {
    const done = v => { y.onclick = n.onclick = dlg.oncancel = null; dlg.close(); res(v); };
    y.onclick = () => done(true); n.onclick = () => done(false); dlg.oncancel = e => { e.preventDefault(); done(false); };
    dlg.showModal(); (danger ? n : y).focus();
  });
}
function crumbs(b, d, l, last) {
  let h = `<a href="#/">Home</a>`;
  if (b) h += ` <span aria-hidden="true">›</span> <a href="${href(b)}">${esc(b.title)}</a>`;
  if (d) h += ` <span aria-hidden="true">›</span> <a href="${href(b, d)}">${esc(d.name)}</a>`;
  if (l) h += ` <span aria-hidden="true">›</span> <a href="${href(b, d, l)}">${esc(l.title)}</a>`;
  return `<nav class="crumbs" aria-label="Breadcrumb">${h}${last ? ` <span aria-hidden="true">›</span> ${esc(last)}` : ''}</nav>`;
}

/* ---------- router ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, ''), [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  return {name: parts[0] || 'home', parts: parts.slice(1), q: new URLSearchParams(qs || '')};
}
let tick = null, lastHash = null, lastView = '', lastScreen = '', prevW = [];
function render() {
  clearInterval(tick); tick = null;
  const r = route();
  const keep = location.hash === lastHash ? $$('details.box', main).map(d => d.open) : null;   // panels stay open when the same page redraws
  const views = {home: vHome, m: vScope, quiz: vQuiz, results: vResults, cards: vCards, mistakes: vMistakes, stats: vStats, search: vSearch, q: vQuestion, settings: vSettings, about: vAbout};
  document.body.dataset.view = views[r.name] ? r.name : 'none';   // the stylesheet shrinks the header in quiz and flashcard views on phones
  (views[r.name] || vNotFound)(r);
  if (keep) $$('details.box', main).forEach((d, i) => { if (keep[i]) d.open = true; });
  // motion: bars and score rings grow from their last value; a new screen fades in (the stylesheet switches this off for reduced motion)
  const bars = $$('[data-w]', main), rings = $$('[data-ring]', main), same = r.name === lastView;
  bars.forEach((e, i) => { e.style.width = (same && prevW[i] != null ? prevW[i] : 0) + '%'; });
  const screen = location.hash + '|' + (r.name === 'quiz' && ses ? ses.i : r.name === 'cards' && cs ? cs.i : '');
  if (screen !== lastScreen) { main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter'); }
  else void main.offsetWidth;
  bars.forEach(e => { e.style.width = (+e.dataset.w || 0) + '%'; });
  rings.forEach(e => { e.style.strokeDashoffset = 100 - (+e.dataset.ring || 0); });
  prevW = bars.map(e => +e.dataset.w || 0); lastView = r.name; lastScreen = screen; lastHash = location.hash;
  const nav = r.name === 'm' || r.name === 'q' ? 'home' : r.name;
  $$('.top [data-nav]').forEach(a => a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
}
let lastRoute = '';
window.addEventListener('hashchange', () => {
  render();
  const now = route().name + '/' + route().parts.join('/');
  if (now !== lastRoute) { lastRoute = now; window.scrollTo(0, 0); main.focus({preventScroll: true}); }
});
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function title(t) { document.title = (t ? t + ' · ' : '') + 'CourseWise'; }
function errorCard() {
  let h = '';
  if (loadErrors.length) h += `<div class="card err" role="alert"><b>Some lecture files did not load</b><ul>${loadErrors.map(e => `<li>${esc(e)}</li>`).join('')}</ul><span class="mute">The rest of the site works. Check data/registry.json and the file names.</span></div>`;
  if (!storageOK) h += `<div class="card err" role="alert"><b>Progress cannot be saved in this browser.</b> Private browsing or blocked site storage is the usual cause.</div>`;
  return h;
}

/* ---------- pages: home, module, discipline, lecture ---------- */
function resumeCard() {
  let h = '';
  if (ses && !ses.done && ses.ids && ses.ids.length)
    h += `<div class="card resume"><div class="row"><div class="grow"><b>Unfinished ${ses.mode === 'exam' ? 'exam' : 'practice'}: ${esc(ses.label)}</b><div class="mute">${Object.keys(ses.ans).length} of ${ses.ids.length} answered</div></div><a class="btn" href="#/quiz">Resume</a></div></div>`;
  if (cs && cs.ids && cs.ids.length && cs.i < cs.ids.length && cs.i > 0)
    h += `<div class="card resume"><div class="row"><div class="grow"><b>Flashcards: ${esc(cs.label)}</b><div class="mute">card ${cs.i + 1} of ${cs.ids.length}</div></div><a class="btn" href="#/cards">Resume</a></div></div>`;
  return h;
}
function lastLecture() {
  const l = LECS.find(x => x.key === settings.last);
  if (!l) return '';
  const st = stats(l.q), cst = cardStats(l.cards);
  return `<div class="card resume"><div class="row"><div class="grow"><b>${esc(l.title)}</b><div class="mute">Last lecture you opened · ${esc(l.d.name)}</div><div class="pills">${statLine(st, cst)}</div></div><a class="btn ghost" href="${href(l.b, l.d, l)}">Open</a></div></div>`;
}
function remember(l) { if (settings.last !== l.key) { settings.last = l.key; write(K.set, settings); } }
function mixRow() {
  const st = stats(Q);
  if (!st.n) return '';
  const b = (act, label, n, ghost) => n ? `<button type="button" class="btn${ghost ? ' ghost' : ''}" data-mix="${act}">${label}</button>` : '';
  return `<div class="row actions">${b('unanswered', st.left > 20 ? '20 new questions' : `New questions (${st.left})`, st.left)}${b('incorrect', `Redo mistakes <span class="cnt">${st.bad}</span>`, st.bad, 1)}${b('flagged', `Flagged <span class="cnt">${st.flag}</span>`, st.flag, 1)}${b('exam', `Timed exam <span class="cnt">${Math.min(40, st.n)}</span>`, st.n, 1)}</div>`;
}
function wireMix() {
  $$('[data-mix]').forEach(btn => btn.onclick = () => {
    const act = btn.dataset.mix, exam = act === 'exam';
    startSession(Q.filter(statusFilter[exam ? 'all' : act]).map(q => q.id), {mode: exam ? 'exam' : 'practice', shuffle: true, max: exam ? 40 : act === 'unanswered' ? 20 : 0,
      label: exam ? 'Mixed exam' : act === 'unanswered' ? 'Mixed · new questions' : act === 'incorrect' ? 'All mistakes' : 'All flagged', sec: 72});
  });
}
const steps = `<ol class="steps"><li><b>Read</b> the short summary of a lecture.</li><li><b>Recall</b> with its flashcards: flip, then mark Known or Again.</li><li><b>Test</b> yourself with exam-style questions. Every answer comes with an explanation.</li></ol>`;
function vHome() {
  title('');
  const st = stats(Q), cst = cardStats(C), sums = LECS.filter(l => l.summary.length).length;
  const day = new Date().setHours(0, 0, 0, 0), tq = Object.values(prog.a).filter(r => r.t >= day).length, tc = Object.values(prog.c).filter(r => r.t >= day).length;
  const fresh = !st.done && !cst.known && !cst.again && !prog.h.length, first = LECS.find(l => l.summary.length && l.q.length) || LECS[0];
  const cont = resumeCard() + lastLecture();
  main.innerHTML = `<section class="hero"><h1>Study by lecture</h1><p>A short summary, flashcards and exam-style questions for every lecture. No account needed; your progress stays on this device.</p>
   <form id="hs" class="row" role="search"><label class="sr" for="hq">Search</label><input class="grow" id="hq" type="search" placeholder="Search a topic, e.g. hepcidin" autocomplete="off" enterkeyhint="search"><button class="btn">Search</button></form>
   ${tq || tc ? `<p class="today"><span class="pill ok">Today</span> ${plural(tq, 'question')} answered${tc ? ' · ' + plural(tc, 'flashcard') + ' reviewed' : ''}</p>` : ''}</section>
  ${errorCard()}
  ${fresh && !settings.intro ? `<section class="card intro" aria-labelledby="introT"><h2 id="introT">How it works</h2>${steps}
    <div class="row">${first ? `<a class="btn" href="${href(first.b, first.d, first)}">Start with ${esc(first.title)}</a>` : ''}<a class="btn ghost" href="#/about">Full guide</a><button type="button" class="btn ghost" id="introX">Hide this</button></div></section>` : ''}
  ${cont ? `<h2>Continue</h2>${cont}` : ''}
  <h2>Modules</h2><div class="grid">${tree.map(b => { const ls = scopeLecs({b}), s = stats(scopeQs({b})), c = cardStats(scopeCards({b}));
    return `<a class="tile" href="${href(b)}"><b>${esc(b.title)}</b><span class="mute">${plural(ls.length, 'lecture')} · ${s.n} questions${c.n ? ' · ' + c.n + ' flashcards' : ''}</span>${bar(s)}<span class="mute small">${s.done ? `${s.done} answered · ${pct(s.ok, s.done)}% correct` : 'Not started'}${c.known ? ` · ${plural(c.known, 'card')} known` : ''}</span><span class="goto" aria-hidden="true">›</span></a>`; }).join('')}</div>
  ${tree.length ? '' : '<div class="card mute">No lectures are published yet.</div>'}
  ${st.n ? `<h2>Mixed practice</h2><p class="sub">Questions from every lecture, shuffled.</p><div class="card">${setToggle({})}<p class="mute">${st.done} of ${st.n} answered${st.done ? ' · ' + pct(st.ok, st.done) + '% correct' : ''}</p>${bar(st)}${mixRow()}</div>${builder({})}` : ''}`;
  $('#hs').onsubmit = e => { e.preventDefault(); go('#/search?q=' + enc($('#hq').value.trim())); };
  if ($('#introX')) $('#introX').onclick = () => { settings.intro = 1; write(K.set, settings); render(); say('Guide hidden. It stays available under Help.'); };
  wireMix(); wireBuilder({}); wireSet();
}
function vScope(r) {
  const [bs, ds, ls, tail] = r.parts, b = tree.find(x => x.slug === bs);
  const d = b && ds ? b.d.find(x => x.slug === ds) : null, l = d && ls ? d.l.find(x => x.slug === ls) : null;
  if (!b || (ds && !d) || (ls && !l) || (tail && !['summary', 'cards'].includes(tail))) return vNotFound();
  if (l && tail === 'summary') return vSummary(l);
  if (l && tail === 'cards') return startCards(l.cards.map(c => c.id), l.title);
  if (l) return vLecture(l);
  const scope = {b, d}, name = scopeName(scope), st = stats(scopeQs(scope)), cst = cardStats(scopeCards(scope));
  title(name);
  const body = d ? `<div class="card">${lecList(d)}</div>` : b.d.map(x => { const s = stats(scopeQs({b, d: x})), c = cardStats(scopeCards({b, d: x}));
    return `<details class="box" ${b.d.length <= 3 ? 'open' : ''}><summary><span class="grow">${esc(x.name)} <span class="mute">· ${plural(x.l.length, 'lecture')}</span></span>${statLine(s, c)}</summary>${lecList(x)}<p class="more"><a class="btn ghost sm" href="${href(b, x)}">Practice ${esc(x.name)} as a whole</a></p></details>`; }).join('');
  main.innerHTML = `${crumbs(d ? b : null)}<h1>${esc(name)}</h1>${b.note && !d ? `<p class="mute">${esc(b.note)}</p>` : ''}${errorCard()}
   <div class="card">${kpis(st)}${bar(st)}${quick(scope)}${cardRow(scope, cst)}</div>
   <h2>${d ? 'Lectures' : 'Disciplines'}</h2>${body}
   ${st.n ? `<h2>Practice options</h2>${setToggle(scope) ? `<div class="card">${setToggle(scope)}</div>` : ''}${builder(scope)}` : ''}`;
  wireQuick(scope); wireBuilder(scope); wireSet();
}
function lecList(d) {
  return `<ul class="list">${d.l.map(x => `<li><a class="name" href="${href(d.b, d, x)}">${esc(x.title)}</a>${lecMeta(x)}</li>`).join('')}</ul>`;
}
function lecMeta(x) {   // quiet text until there is progress to show
  const st = stats(x.q), c = cardStats(x.cards);
  if (st.done || st.flag || c.known || c.again) return statLine(st, c);
  return `<span class="mute small">${[st.n ? st.n + ' questions' : '', c.n ? c.n + ' cards' : ''].filter(Boolean).join(' · ') || 'Coming soon'}</span>`;
}
function cardRow(scope, cst) {
  if (!cst.n) return '';
  return `<div class="row cardrow"><span class="grow mute">${cst.n} flashcards · ${cst.known} known · ${cst.again} to repeat · ${cst.fresh} new</span>
   ${cst.n - cst.known ? `<button type="button" class="btn ghost sm" data-cards="todo">Study cards not yet known <span class="cnt">${cst.n - cst.known}</span></button>` : ''}<button type="button" class="btn ghost sm" data-cards="all">Study all cards</button></div>`;
}
function quick(scope) {
  const st = stats(scopeQs(scope));
  if (!st.n) return '<p class="mute">No questions for this lecture yet.</p>';
  const b = (act, label, n, ghost) => n ? `<button type="button" class="btn${ghost ? ' ghost' : ''}" data-quick="${act}">${label} <span class="cnt">${n}</span></button>` : '';
  return `<div class="row actions">${b('unanswered', st.done ? 'Continue with new questions' : 'Practice', st.left)}${b('all', st.left ? 'All questions' : 'Practice again', st.n, st.left)}${b('incorrect', 'Redo mistakes', st.bad, 1)}${b('flagged', 'Flagged', st.flag, 1)}${b('exam', 'Timed exam', scope.l ? st.n : Math.min(40, st.n), 1)}</div>`;
}
function wireQuick(scope) {
  const label = scopeName(scope);
  $$('[data-quick]').forEach(btn => btn.onclick = () => {
    const act = btn.dataset.quick, exam = act === 'exam';
    startSession(scopeQs(scope).filter(statusFilter[exam ? 'all' : act]).map(q => q.id), {mode: exam ? 'exam' : 'practice', shuffle: exam || !scope.l, max: exam && !scope.l ? 40 : 0, label: label + (exam || act === 'all' ? '' : ' · ' + act), sec: 72});
  });
  $$('[data-cards]').forEach(btn => btn.onclick = () => startCards(scopeCards(scope).filter(cardFilter[btn.dataset.cards]).map(c => c.id), label, !scope.l));
}
function pager(l) {
  const i = l.d.l.indexOf(l), p = l.d.l[i - 1], n = l.d.l[i + 1];
  if (!p && !n) return '';
  return `<nav class="pager" aria-label="Other lectures in ${esc(l.d.name)}">${p ? `<a href="${href(l.b, l.d, p)}"><span class="mute small">‹ Previous lecture</span><b>${esc(p.title)}</b></a>` : '<span></span>'}${n ? `<a class="r" href="${href(l.b, l.d, n)}"><span class="mute small">Next lecture ›</span><b>${esc(n.title)}</b></a>` : '<span></span>'}</nav>`;
}
function vLecture(l) {
  title(l.title); remember(l);
  const scope = {b: l.b, d: l.d, l}, st = stats(l.q), cst = cardStats(l.cards);
  main.innerHTML = `${crumbs(l.b, l.d)}<h1>${esc(l.title)}</h1>${l.covers ? `<p class="covers"><b>Covers:</b> ${esc(l.covers)}</p>` : ''}${errorCard()}
   <div class="grid three">
    <section class="card"><span class="step">1 · Read</span><h2>Summary</h2>${l.summary.length ? `<p class="mute">The high-yield points, in ${plural(l.summary.length, 'short section')}.</p><a class="btn" href="${href(l.b, l.d, l, 'summary')}">Read summary</a>` : '<p class="mute">Not written yet.</p>'}</section>
    <section class="card"><span class="step">2 · Recall</span><h2>Flashcards</h2>${cst.n ? `<p class="mute">${cst.n} cards · ${cst.known} known · ${cst.again} to repeat</p><div class="row"><button type="button" class="btn" data-cards="${cst.n - cst.known ? 'todo' : 'all'}">${cst.known && cst.n - cst.known ? 'Continue' : 'Study'}</button>${cst.known ? '<button type="button" class="btn ghost" data-cards="all">All</button>' : ''}</div>` : '<p class="mute">Not written yet.</p>'}</section>
    <section class="card"><span class="step">3 · Test</span><h2>Questions</h2><p class="mute">${st.n ? `${st.n} questions · ${st.done} answered${st.done ? ' · ' + pct(st.ok, st.done) + '% correct' : ''}` : 'Not written yet.'}</p>${st.n ? `<button type="button" class="btn" data-quick="${st.left ? 'unanswered' : 'all'}">${st.done && st.left ? 'Continue' : st.left ? 'Practice' : 'Practice again'}</button>` : ''}</section>
   </div>
   ${st.n ? `<h2>More</h2><details class="box"><summary>Practice options <span class="mute">${hasShort(l) ? '· ' + (setName() === 'hy' ? 'high-yield set' : 'full set') : ''}</span></summary>${setToggle(scope)}${bar(st)}${quick(scope)}</details>${builder(scope)}
   <details class="box"><summary>Question list <span class="mute">· ${st.n}</span></summary><ul class="list">${l.q.map((q, i) => { const a = prog.a[q.id];
     return `<li><a class="name plain" href="${qHref(q)}">${i + 1}. ${esc(q.stem.length > 150 ? q.stem.slice(0, 150) + '…' : q.stem)}</a>${a ? `<span class="pill ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'correct' : 'incorrect'}</span>` : '<span class="pill">new</span>'}${prog.f[q.id] ? '<span class="pill flag">flagged</span>' : ''}</li>`; }).join('')}</ul></details>` : ''}
   ${pager(l)}`;
  wireQuick(scope); wireBuilder(scope); wireSet();
}
function vSummary(l) {
  title(l.title + ' summary');
  if (!l.summary.length) return vLecture(l);
  remember(l);
  const item = it => it.p ? `<p>${esc(it.p)}</p>` : it.ul ? `<ul>${it.ul.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` :
    it.note ? `<p class="callout"><b>Note:</b> ${esc(it.note)}</p>` :
    it.img ? `<figure><img src="${esc(it.img)}" alt="${esc(it.alt || it.caption || 'Slide figure')}" loading="lazy">${it.caption ? `<figcaption>${esc(it.caption)}</figcaption>` : ''}</figure>` :
    it.table ? `<div class="tablewrap" tabindex="0" role="group" aria-label="Table"><table><thead><tr>${it.table[0].map(c => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${it.table.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  main.innerHTML = `${crumbs(l.b, l.d, l, 'Summary')}<article class="prose"><h1>${esc(l.title)}</h1>${l.covers ? `<p class="covers"><b>Covers:</b> ${esc(l.covers)}</p>` : ''}
   ${l.summary.length > 3 ? `<nav class="toc" aria-label="Sections of this summary"><span class="mute small">Jump to</span>${l.summary.map((s, i) => `<button type="button" class="seg" data-sec="${i}">${esc(s.h)}</button>`).join('')}</nav>` : ''}
   ${l.summary.map((s, i) => `<section><h2 id="sec${i}" tabindex="-1">${esc(s.h)}</h2>${(s.items || []).map(item).join('')}</section>`).join('')}
   <div class="next"><h2>Next step</h2><div class="row">${l.cards.length ? `<a class="btn" href="${href(l.b, l.d, l, 'cards')}">Flashcards (${l.cards.length})</a>` : ''}${l.q.length ? `<button type="button" class="btn${l.cards.length ? ' ghost' : ''}" id="sumQ">Questions (${l.q.length})</button>` : ''}<a class="btn ghost" href="${href(l.b, l.d, l)}">Lecture page</a></div></div></article>`;
  if ($('#sumQ')) $('#sumQ').onclick = () => startSession(l.q.map(q => q.id), {mode: 'practice', label: l.title});
  $$('[data-sec]').forEach(b => b.onclick = () => { const h = $('#sec' + b.dataset.sec); h.scrollIntoView({block: 'start'}); h.focus({preventScroll: true}); });
}
/* ---------- custom quiz panel ---------- */
function builder(scope) {
  const lecs = scopeLecs(scope).filter(l => l.q.length);
  if (!lecs.length) return '';
  let t = '', lastB = null, lastD = null;
  for (const l of lecs) {
    if (!scope.b && l.b !== lastB) { t += `<label class="b"><input type="checkbox" data-tb="${l.b.slug}" checked> ${esc(l.b.title)}</label>`; lastB = l.b; }
    if (!scope.d && l.d !== lastD) { t += `<label class="d"><input type="checkbox" data-tb="${l.b.slug}" data-td="${l.d.slug}" checked> ${esc(l.d.name)}</label>`; lastD = l.d; }
    t += `<label class="l"><input type="checkbox" class="lec" data-tb="${l.b.slug}" data-td="${l.d.slug}" value="${esc(l.key)}" checked> <span>${esc(l.title)} <span class="mute">(${l.q.length})</span></span></label>`;
  }
  return `<details class="box" id="bld"><summary>Custom quiz <span class="mute" id="bN"></span></summary>
  ${scope.l ? `<div hidden>${t}</div>` : `<fieldset><legend>Lectures</legend><div class="row"><button type="button" class="btn ghost sm" id="bAll">All</button><button type="button" class="btn ghost sm" id="bNone">None</button></div><div class="tree">${t}</div></fieldset>`}
  <fieldset class="checks"><legend>Questions</legend>
   <label><input type="radio" name="bS" value="all" checked> All</label><label><input type="radio" name="bS" value="unanswered"> Unanswered</label>
   <label><input type="radio" name="bS" value="incorrect"> Incorrect</label><label><input type="radio" name="bS" value="flagged"> Flagged</label></fieldset>
  <fieldset class="checks"><legend>Style</legend><label><input type="checkbox" class="bSty" value="LAU" checked> Direct</label><label><input type="checkbox" class="bSty" value="Step1" checked> Clinical vignette</label></fieldset>
  <fieldset class="checks"><legend>Mode</legend>
   <label><input type="radio" name="bM" value="practice" checked> Practice (answer shown at once)</label><label><input type="radio" name="bM" value="exam"> Exam (timed, answers at the end)</label></fieldset>
  <div class="row"><label><input type="checkbox" id="bShuf" checked> Shuffle</label>
   <label>Max questions <input type="number" id="bMax" min="1" inputmode="numeric" placeholder="all"></label>
   <label>Seconds per question (exam) <input type="number" id="bSec" min="10" value="72" inputmode="numeric"></label></div>
  <div class="row end"><button type="button" class="btn" id="bGo">Start</button></div></details>`;
}
function wireBuilder(scope) {
  const box = $('#bld'); if (!box) return;
  const pool = () => {
    const ls = new Set($$('.lec', box).filter(x => x.checked).map(x => x.value)), sty = $$('.bSty', box).filter(x => x.checked).map(x => x.value);
    const f = statusFilter[$('input[name=bS]:checked', box).value];
    return Q.filter(q => ls.has(q.lec.key) && sty.includes(q.style) && f(q));
  };
  const upd = () => { const n = pool().length; $('#bN').textContent = '· ' + n + ' match'; $('#bGo').disabled = !n; };
  box.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.tb && !t.classList.contains('lec')) $$('input[data-tb]', box).forEach(x => { if (x.dataset.tb === t.dataset.tb && (!t.dataset.td || x.dataset.td === t.dataset.td)) x.checked = t.checked; });
    upd();
  });
  const all = v => { $$('.tree input', box).forEach(x => { x.checked = v; }); upd(); };
  if ($('#bAll')) { $('#bAll').onclick = () => all(true); $('#bNone').onclick = () => all(false); }
  $('#bGo').onclick = () => {
    const mode = $('input[name=bM]:checked', box).value, st = $('input[name=bS]:checked', box).value;
    startSession(pool().map(q => q.id), {mode, shuffle: $('#bShuf').checked, max: +$('#bMax').value || 0, sec: +$('#bSec').value || 72, label: scopeName(scope) + (st === 'all' ? '' : ' · ' + st)});
  };
  upd();
}

/* ---------- quiz ---------- */
async function startSession(ids, o) {
  ids = ids.filter(id => byId[id]);
  if (!ids.length) return;
  if (ses && !ses.done && ses.mode === 'exam' && Object.keys(ses.ans).length &&
      !(await ask('Replace the unfinished exam?', '<p>An exam is still in progress. Starting a new quiz discards its answers.</p>', 'Start new quiz', true))) return;
  if (o.shuffle) shuffle(ids);
  if (o.max > 0) ids = ids.slice(0, o.max);
  ses = {ids, i: 0, mode: o.mode === 'exam' ? 'exam' : 'practice', ans: {}, label: o.label || 'Quiz', start: Date.now(), limit: o.mode === 'exam' ? ids.length * (o.sec || 72) : 0, done: false};
  saveSes(); go('#/quiz');
}
function record(q, letter) {
  const ok = letter === q.answer ? 1 : 0, r = prog.a[q.id] || {n: 0, w: 0};
  prog.a[q.id] = {l: letter, ok, n: r.n + 1, w: r.w + (ok ? 0 : 1), t: Date.now()};
}
function vQuiz() {
  if (!ses || !ses.ids || !ses.ids.length) { title('Quiz'); main.innerHTML = `<h1>No quiz in progress</h1><p class="mute">Open a lecture and press Practice, or start a mixed quiz from the home page.</p><p><a class="btn" href="#/">Choose questions</a></p>`; return; }
  if (ses.done) return go('#/results');
  ses.i = Math.min(Math.max(0, ses.i), ses.ids.length - 1);
  const q = byId[ses.ids[ses.i]], exam = ses.mode === 'exam', mine = ses.ans[ses.i], shown = !exam && mine;
  if (!q) { ses = null; saveSes(); return go('#/'); }
  title((exam ? 'Exam' : 'Practice') + ' ' + (ses.i + 1) + '/' + ses.ids.length);
  const opts = Object.entries(q.options).map(([k, v]) => {
    const cls = shown ? (k === q.answer ? ' right' : k === mine ? ' wrong' : '') : '';
    return `<button type="button" class="opt${cls}" role="radio" aria-checked="${mine === k}" data-k="${k}" ${shown ? 'disabled' : ''}><span class="k">${k}</span><span>${esc(v)}${shown && k === q.answer ? ' <span class="sr">(correct answer)</span>' : ''}${shown && k === mine && k !== q.answer ? ' <span class="sr">(your answer)</span>' : ''}</span></button>`;
  }).join('');
  const answered = Object.keys(ses.ans).length, last = ses.i === ses.ids.length - 1;
  main.innerHTML = `<div class="qhead"><span class="pill strong">${exam ? 'Exam' : 'Practice'} · ${ses.i + 1} of ${ses.ids.length}</span><span class="pill">${esc(q.lec.d.name)}</span><span class="pill">${esc(q.lec.title)}</span>${q.style === 'Step1' ? '<span class="pill">Vignette</span>' : ''}
    <span class="grow"></span>${exam ? `<span class="timer" id="timer" role="timer" aria-label="Time left"></span>` : ''}
    <button type="button" class="btn ghost sm flagbtn" id="flag" aria-pressed="${!!prog.f[q.id]}" title="Flag (F)">⚑ ${prog.f[q.id] ? 'Flagged' : 'Flag'}</button></div>
   <div class="progressline" aria-hidden="true"><i data-w="${100 * answered / ses.ids.length}"></i></div>
   <h1 class="sr">Question ${ses.i + 1}</h1><p class="stem" id="stem">${esc(q.stem)}</p>
   <div role="radiogroup" aria-labelledby="stem">${opts}</div>
   <div id="exp">${shown ? `<div class="exp ${mine === q.answer ? 'good' : 'poor'}"><b>${mine === q.answer ? 'Correct' : 'Incorrect. Answer: ' + q.answer}</b>${fmtExp(q.explanation)}<div class="mute small">${esc(q.source)}${q.lec.summary.length ? ` · <a href="${href(q.lec.b, q.lec.d, q.lec, 'summary')}">Lecture summary</a>` : ''}</div></div>` : ''}</div>
   <div class="sticky"><div class="row bar3"><button type="button" class="btn ghost" id="prev" ${ses.i ? '' : 'disabled'} aria-label="Previous question">‹ <span class="wide">Previous</span></button>
    <button type="button" class="btn grow" id="next">${last ? (exam ? 'Submit exam' : 'Finish') : 'Next ›'}</button>
    <button type="button" class="btn ghost" id="end">${exam ? 'Submit' : 'End'}</button></div>
    <details><summary class="mute">Question list · ${answered}/${ses.ids.length} answered</summary><div class="navgrid">${ses.ids.map((id, j) => { const a = ses.ans[j], qq = byId[id];
      const c = a ? (exam ? 'done' : a === qq.answer ? 'ok' : 'no') : '';
      return `<button type="button" data-j="${j}" class="${c}${j === ses.i ? ' cur' : ''}${prog.f[id] ? ' fl' : ''}" aria-label="Question ${j + 1}${a ? ', answered' : ''}${prog.f[id] ? ', flagged' : ''}">${j + 1}</button>`; }).join('')}</div>
     <p class="mute small keys"><kbd>A</kbd>–<kbd>E</kbd> or <kbd>1</kbd>–<kbd>5</kbd> answer · <kbd>Enter</kbd> or <kbd>→</kbd> next · <kbd>←</kbd> previous · <kbd>F</kbd> flag</p></details></div>`;
  $$('.opt').forEach(b => b.onclick = () => pick(b.dataset.k));
  $('#prev').onclick = () => move(-1); $('#next').onclick = () => move(1); $('#end').onclick = () => finish(false);
  $('#flag').onclick = toggleFlag;
  $$('.navgrid button').forEach(b => b.onclick = () => { ses.i = +b.dataset.j; saveSes(); render(); window.scrollTo(0, 0); });
  if (exam) {
    const t = $('#timer'), paint = () => { const left = ses.limit - (Date.now() - ses.start) / 1000; t.textContent = fmtTime(left); t.classList.toggle('low', left < 60); if (left <= 0) finish(true); };
    paint(); if (!ses.done) tick = setInterval(paint, 1000);
  }
}
function pick(k) {
  if (!ses || ses.done || route().name !== 'quiz') return;
  const q = byId[ses.ids[ses.i]]; if (!q || q.options[k] == null) return;
  if (ses.mode === 'exam') { ses.ans[ses.i] = k; saveSes(); render(); say('Selected ' + k); return; }
  if (ses.ans[ses.i]) return;
  ses.ans[ses.i] = k; record(q, k); saveProg(); saveSes(); render();
  say(k === q.answer ? 'Correct' : 'Incorrect. The answer is ' + q.answer);
  const o = $('.opt[data-k="' + k + '"]'); if (o) o.classList.add(k === q.answer ? 'pop' : 'shake');
  if ($('.exp')) $('.exp').classList.add('reveal');
  const e = $('#exp'); if (e && e.scrollIntoView) e.scrollIntoView({block: 'nearest'});
}
function move(step) {
  if (!ses || ses.done) return;
  const j = ses.i + step;
  if (j < 0) return;
  if (j >= ses.ids.length) return finish(false);
  ses.i = j; saveSes(); render(); window.scrollTo(0, 0);
}
function toggleFlag() {
  const id = ses.ids[ses.i];
  if (prog.f[id]) delete prog.f[id]; else prog.f[id] = 1;
  saveProg(); render(); say(prog.f[id] ? 'Flagged' : 'Flag removed');
}
let finishing = false;
async function finish(timeUp) {
  if (!ses || ses.done || finishing) return;
  const left = ses.ids.length - Object.keys(ses.ans).length, exam = ses.mode === 'exam';
  if (!timeUp && (exam || left)) {
    finishing = true;
    const ok = await ask(exam ? 'Submit the exam?' : 'End this quiz?', `<p>${left ? left + ' question' + (left === 1 ? ' is' : 's are') + ' not answered.' : 'All questions are answered.'}</p>`, exam ? 'Submit' : 'End quiz');
    finishing = false;
    if (!ok) return;
  }
  clearInterval(tick); tick = null;
  if (exam) ses.ids.forEach((id, j) => { if (ses.ans[j]) record(byId[id], ses.ans[j]); });
  ses.done = true; ses.end = Date.now(); ses.timeUp = !!timeUp;
  const n = Object.keys(ses.ans).length, ok = ses.ids.filter((id, j) => ses.ans[j] === byId[id].answer).length;
  if (n) { prog.h.push({t: ses.end, mode: ses.mode, label: ses.label, n, ok, total: ses.ids.length, sec: Math.round((ses.end - ses.start) / 1000)}); prog.h = prog.h.slice(-60); }
  saveProg(); saveSes(); go('#/results');
}
function reviewItem(q, mine) {
  return `<details class="box"><summary><span class="pill ${mine == null ? '' : mine === q.answer ? 'ok' : 'bad'}">${mine == null ? 'skipped' : mine === q.answer ? 'correct' : 'incorrect'}</span>${prog.f[q.id] ? '<span class="pill flag">flagged</span>' : ''}<span class="grow plain">${esc(q.stem.length > 140 ? q.stem.slice(0, 140) + '…' : q.stem)}</span></summary>
   <p class="mute small">${esc(q.lec.d.name)} · ${esc(q.lec.title)}</p><p class="stem">${esc(q.stem)}</p>
   ${Object.entries(q.options).map(([k, v]) => `<div class="opt${k === q.answer ? ' right' : k === mine ? ' wrong' : ''}"><span class="k">${k}</span><span>${esc(v)}${k === q.answer ? ' <b>(correct)</b>' : k === mine ? ' <b>(your answer)</b>' : ''}</span></div>`).join('')}
   <div class="exp">${fmtExp(q.explanation)}<div class="mute small">${esc(q.source)}</div></div></details>`;
}
function breakdown(rows) {
  const by = new Map();
  for (const [q, a] of rows) { for (const key of [q.lec.d.name, q.lec.d.name + '\u0001' + q.lec.title]) { const v = by.get(key) || [0, 0]; v[1]++; if (a === q.answer) v[0]++; by.set(key, v); } }
  return `<div class="tablewrap"><table><thead><tr><th scope="col">Discipline / lecture</th><th scope="col" class="n">Correct</th><th scope="col" class="n">%</th></tr></thead><tbody>${[...by.keys()].sort().map(k => { const v = by.get(k), sub = k.includes('\u0001');
    return `<tr class="${sub ? '' : 'd'}"><td>${sub ? '&emsp;' + esc(k.split('\u0001')[1]) : esc(k)}</td><td class="n">${v[0]}/${v[1]}</td><td class="n">${pct(v[0], v[1])}</td></tr>`; }).join('')}</tbody></table></div>`;
}
function vResults() {
  title('Results');
  if (!ses || !ses.done) { main.innerHTML = `<h1>No finished quiz</h1><p><a class="btn" href="#/">Home</a></p>`; return; }
  const rows = ses.ids.map((id, j) => [byId[id], ses.ans[j]]).filter(x => x[0]), done = rows.filter(x => x[1]), ok = done.filter(([q, a]) => a === q.answer).length;
  const wrong = rows.filter(([q, a]) => a !== q.answer), score = done.length ? pct(ok, done.length) : 0;
  const verdict = score >= 85 ? 'Excellent' : score >= 70 ? 'Good work' : score >= 50 ? 'Getting there' : 'Worth another pass';
  main.innerHTML = `<h1>${ses.mode === 'exam' ? 'Exam' : 'Practice'} result</h1><p class="mute">${esc(ses.label)}${ses.timeUp ? ' · time ran out' : ''}</p>
   <div class="card"><div class="result">${ring(score, 'Score')}<div><b class="big">${done.length ? verdict : 'No questions answered'}</b>
     <p class="mute">${ok} of ${done.length} correct${rows.length - done.length ? ' · ' + (rows.length - done.length) + ' skipped' : ''} · ${fmtTime((ses.end - ses.start) / 1000)}</p></div></div>
   ${new Set(done.map(x => x[0].lec)).size > 1 ? breakdown(done) : ''}
   <div class="row actions mt">${wrong.length ? `<button type="button" class="btn" id="redo">Redo incorrect and skipped <span class="cnt">${wrong.length}</span></button>` : ''}<a class="btn${wrong.length ? ' ghost' : ''}" href="#/">Home</a><button type="button" class="btn ghost" id="save" ${done.length ? '' : 'disabled'}>Save results file</button></div></div>
   <h2>Review</h2><div class="checks"><label><input type="checkbox" id="onlyBad"> Show incorrect and skipped only</label></div><div id="rev"></div>`;
  const paint = () => { const only = $('#onlyBad').checked; $('#rev').innerHTML = rows.filter(([q, a]) => !only || a !== q.answer).map(([q, a]) => reviewItem(q, a)).join('') || '<p class="mute">Nothing to show.</p>'; };
  $('#onlyBad').onchange = paint; paint();
  if ($('#redo')) $('#redo').onclick = () => startSession(wrong.map(x => x[0].id), {mode: 'practice', label: ses.label + ' · redo'});
  $('#save').onclick = () => { const now = new Date(ses.end).toISOString();
    download('quiz_results_' + stamp() + '.json', done.map(([q, a]) => ({id: q.id, discipline: q.lec.d.name, lecture: q.lec.title, style: q.style, your_answer: a, correct_answer: q.answer, correct: a === q.answer, date: now}))); };
}

/* ---------- flashcards ---------- */
function startCards(ids, label, mix) {
  ids = ids.filter(id => cardById[id]);
  if (!ids.length) { title('Flashcards'); main.innerHTML = `<h1>No flashcards here yet</h1><p><a class="btn" href="#/">Home</a></p>`; return; }
  cs = {ids: mix ? shuffle(ids) : ids, i: 0, flipped: false, label: label || 'Flashcards', known: 0, again: 0};
  saveCs();
  if (route().name === 'cards') render(); else location.replace('#/cards');
}
function vCards() {
  title('Flashcards');
  if (!cs || !cs.ids || !cs.ids.length) { main.innerHTML = `<h1>No flashcards in progress</h1><p class="mute">Open a lecture and choose Flashcards.</p><p><a class="btn" href="#/">Home</a></p>`; return; }
  if (cs.i >= cs.ids.length) {
    const again = cs.ids.filter(id => prog.c[id] && prog.c[id].s === 'again');
    main.innerHTML = `<h1>Deck finished</h1><p class="mute">${esc(cs.label)}</p><div class="card"><div class="result">${ring(pct(cs.known, cs.ids.length), 'Known')}<div><b class="big">${cs.known === cs.ids.length ? 'All known' : cs.known + ' of ' + cs.ids.length + ' known'}</b><p class="mute">${cs.again} marked again${cs.ids.length - cs.known - cs.again ? ' · ' + (cs.ids.length - cs.known - cs.again) + ' skipped' : ''}</p></div></div>
     <div class="row actions mt">${again.length ? `<button type="button" class="btn" id="cAgain">Repeat the "again" cards <span class="cnt">${again.length}</span></button>` : ''}<button type="button" class="btn ghost" id="cAll">Restart deck</button><a class="btn${again.length ? ' ghost' : ''}" href="#/">Home</a></div></div>`;
    if ($('#cAgain')) $('#cAgain').onclick = () => startCards(again, cs.label); $('#cAll').onclick = () => startCards(cs.ids.slice(), cs.label);
    return;
  }
  const c = cardById[cs.ids[cs.i]];
  if (!c) { cs = null; saveCs(); return go('#/'); }
  const mark = prog.c[c.id];
  main.innerHTML = `<div class="qhead"><span class="pill strong">Flashcards · ${cs.i + 1} of ${cs.ids.length}</span><span class="pill">${esc(c.lec.d.name)}</span><span class="pill">${esc(c.lec.title)}</span>${mark ? `<span class="pill ${mark.s === 'known' ? 'ok' : 'bad'}">${mark.s === 'known' ? 'known' : 'again'}</span>` : ''}</div>
   <div class="progressline" aria-hidden="true"><i data-w="${100 * cs.i / cs.ids.length}"></i></div><h1 class="sr">Flashcard ${cs.i + 1}</h1>
   <button type="button" class="flash${cs.flipped ? ' back' : ''}" id="flash" aria-live="polite" aria-label="${cs.flipped ? 'Answer. Press to show the question again' : 'Question. Press to show the answer'}">
     <span class="side">${cs.flipped ? 'Answer' : 'Question'}</span><span class="face">${esc(cs.flipped ? c.a : c.q)}</span>${cs.flipped && c.x ? `<span class="extra">${esc(c.x)}</span>` : ''}${cs.flipped && c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : ''}${cs.flipped ? `<span class="asked">${esc(c.q)}</span>` : '<span class="hint">Space or Enter to flip</span>'}</button>
   <div class="sticky"><div class="row bar3"><button type="button" class="btn ghost" id="cPrev" ${cs.i ? '' : 'disabled'} aria-label="Previous card">‹ <span class="wide">Previous</span></button>
    ${cs.flipped ? `<button type="button" class="btn again grow" id="cNo">Again <kbd>1</kbd></button><button type="button" class="btn known grow" id="cYes">Known <kbd>2</kbd></button>` : `<button type="button" class="btn grow" id="cFlip">Show answer</button>`}
    <button type="button" class="btn ghost" id="cNext">Skip ›</button></div>
    <p class="mute small keys"><kbd>Space</kbd> or <kbd>Enter</kbd> flip · <kbd>1</kbd> again · <kbd>2</kbd> known · <kbd>→</kbd> next · <kbd>←</kbd> previous${c.lec.summary.length ? ` · <a href="${href(c.lec.b, c.lec.d, c.lec, 'summary')}">Lecture summary</a>` : ''}</p></div>`;
  $('#flash').onclick = flipCard; $('#cPrev').onclick = () => moveCard(-1); $('#cNext').onclick = () => moveCard(1);
  if (cs.flipped) { $('#cNo').onclick = () => markCard('again'); $('#cYes').onclick = () => markCard('known'); } else $('#cFlip').onclick = flipCard;
}
function flipCard() { if (!cs || cs.i >= cs.ids.length) return; cs.flipped = !cs.flipped; saveCs(); render(); const f = $('#flash'); if (f) { f.classList.add('flipin'); f.focus({preventScroll: true}); } }
function moveCard(step) {
  if (!cs) return;
  const j = cs.i + step; if (j < 0 || j > cs.ids.length) return;
  cs.i = j; cs.flipped = false; saveCs(); render(); window.scrollTo(0, 0);
}
function markCard(s) {
  if (!cs || cs.i >= cs.ids.length || !cs.flipped) return;
  const id = cs.ids[cs.i], r = prog.c[id] || {n: 0};
  prog.c[id] = {s, n: r.n + 1, t: Date.now()}; cs[s]++;
  saveProg(); say(s === 'known' ? 'Marked known' : 'Marked again'); moveCard(1);
}

/* ---------- other pages: mistakes, stats, search, single question, settings ---------- */
function vMistakes() {
  title('Mistakes');
  const bad = Q.filter(statusFilter.incorrect), groups = new Map();
  for (const q of bad) { if (!groups.has(q.lec)) groups.set(q.lec, []); groups.get(q.lec).push(q); }
  const lecs = [...groups.keys()];
  main.innerHTML = `<h1>Mistakes</h1><p class="mute">Questions whose latest answer was wrong. A question leaves this list when you answer it correctly.</p>
   ${bad.length ? `<div class="row"><button type="button" class="btn" id="redoAll">Redo all (${bad.length})</button></div>` : ''}
   ${bad.length ? '' : `<div class="card empty" data-icon="✓"><b>${Object.keys(prog.a).length ? 'Nothing to fix right now.' : 'No mistakes yet.'}</b><p class="mute">When you answer a question wrong it is collected here, grouped by lecture, so you can redo exactly those.</p><a class="btn ghost" href="#/">Practice questions</a></div>`}
   ${lecs.map((l, i) => `<h2>${esc(l.d.name)} · ${esc(l.title)} <button type="button" class="btn ghost sm" data-redo="${i}">Redo ${groups.get(l).length}</button></h2>${groups.get(l).map(q => reviewItem(q, prog.a[q.id].l)).join('')}`).join('')}`;
  if ($('#redoAll')) $('#redoAll').onclick = () => startSession(bad.map(q => q.id), {mode: 'practice', shuffle: true, label: 'All mistakes'});
  $$('[data-redo]').forEach(b => b.onclick = () => { const l = lecs[+b.dataset.redo]; startSession(groups.get(l).map(q => q.id), {mode: 'practice', label: l.title + ' · mistakes'}); });
}
function vStats() {
  title('Stats');
  const st = stats(Q), cst = cardStats(C);
  const row = (cls, label, s, c) => `<tr class="${cls}"><td>${label}</td><td class="n">${s.done}/${s.n}</td><td class="n">${s.done ? pct(s.ok, s.done) + '%' : '–'}</td><td class="n">${s.bad}</td><td class="n">${s.flag}</td><td class="n">${c.n ? c.known + '/' + c.n : '–'}</td></tr>`;
  let rows = '';
  for (const b of tree) {
    rows += row('d', `<a href="${href(b)}">${esc(b.title)}</a>`, stats(scopeQs({b})), cardStats(scopeCards({b})));
    for (const d of b.d) {
      rows += row('', `<b><a href="${href(b, d)}">${esc(d.name)}</a></b>`, stats(scopeQs({b, d})), cardStats(scopeCards({b, d})));
      for (const l of d.l) rows += row('', `&emsp;<a href="${href(b, d, l)}">${esc(l.title)}</a>`, stats(l.q), cardStats(l.cards));
    }
  }
  const hist = prog.h.slice().reverse().slice(0, 20);
  main.innerHTML = `<h1>Stats</h1><div class="card">${kpis(st)}${bar(st)}<p class="mute small">${LECS.some(hasShort) ? 'Counting the ' + (setName() === 'hy' ? 'high-yield (short)' : 'full') + ' question set where a lecture has both. ' : ''}Accuracy counts the latest answer to each question. Flashcards: ${cst.known} of ${cst.n} marked known, ${cst.again} to repeat.</p></div>
   <div class="card tablewrap"><table><thead><tr><th scope="col">Module / discipline / lecture</th><th scope="col" class="n">Questions</th><th scope="col" class="n">Accuracy</th><th scope="col" class="n">Wrong</th><th scope="col" class="n">Flagged</th><th scope="col" class="n">Cards known</th></tr></thead><tbody>${rows}</tbody></table></div>
   <h2>Recent sessions</h2><div class="card tablewrap">${hist.length ? `<table><thead><tr><th scope="col">Date</th><th scope="col">Quiz</th><th scope="col">Mode</th><th scope="col" class="n">Score</th><th scope="col" class="n">Time</th></tr></thead><tbody>${hist.map(h => `<tr><td>${esc(new Date(h.t).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}))}</td><td>${esc(h.label)}</td><td>${esc(h.mode)}</td><td class="n">${h.ok}/${h.n} (${pct(h.ok, h.n)}%)</td><td class="n">${fmtTime(h.sec)}</td></tr>`).join('')}</tbody></table>` : '<span class="mute">No sessions yet. Finished quizzes and exams are listed here with score and time.</span>'}</div>`;
}
function hilite(text, term) {
  const words = term.split(/\s+/).filter(Boolean).map(w => esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let h = esc(text);
  if (words.length) h = h.replace(new RegExp('(' + words.join('|') + ')', 'gi'), '<mark>$1</mark>');
  return h;
}
function vSearch(r) {
  title('Search');
  const term = (r.q.get('q') || '').trim();
  main.innerHTML = `<h1>Search</h1><form id="sf" class="row" role="search"><label class="sr" for="sq">Search</label><input class="grow" id="sq" type="search" value="${esc(term)}" placeholder="Words in a lecture title, question, explanation or flashcard" autocomplete="off"><button class="btn">Search</button></form><div id="sr" aria-live="polite"></div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); go('#/search?q=' + enc($('#sq').value.trim())); };
  if (!term) { $('#sr').innerHTML = '<p class="mute">Searches lecture titles, questions with their explanations, and flashcards. Results can be practiced as a quiz.</p>'; $('#sq').focus(); return; }
  const words = term.toLowerCase().split(/\s+/).filter(Boolean), has = s => { s = s.toLowerCase(); return words.every(w => s.includes(w)); };
  const lecs = LECS.filter(l => has(l.title + ' ' + l.covers + ' ' + l.d.name));
  const qs = Q.filter(q => has(q.stem + ' ' + Object.values(q.options).join(' ') + ' ' + q.explanation + ' ' + q.lec.title));
  const cards = C.filter(c => has(c.q + ' ' + c.a + ' ' + c.x));
  const tag = l => `<span class="pill">${esc(l.d.name)}</span><span class="pill">${esc(l.title)}</span>`;
  $('#sr').innerHTML = `<p class="mute" id="sN">${plural(lecs.length, 'lecture')}, ${plural(qs.length, 'question')}, ${plural(cards.length, 'flashcard')} found</p>
   ${lecs.length ? `<h2>Lectures</h2><div class="card"><ul class="list">${lecs.slice(0, 30).map(l => `<li><a class="name" href="${href(l.b, l.d, l)}">${hilite(l.title, term)}</a><span class="pill">${esc(l.d.name)}</span></li>`).join('')}</ul></div>` : ''}
   ${qs.length ? `<h2>Questions ${qs.length > 60 ? '(first 60)' : ''} <button type="button" class="btn ghost sm" id="sp">Practice these</button></h2><div class="card"><ul class="list">${qs.slice(0, 60).map(q => `<li><a class="name plain" href="${qHref(q)}">${hilite(q.stem.length > 220 ? q.stem.slice(0, 220) + '…' : q.stem, term)}</a>${tag(q.lec)}</li>`).join('')}</ul></div>` : ''}
   ${cards.length ? `<h2>Flashcards ${cards.length > 40 ? '(first 40)' : ''} <button type="button" class="btn ghost sm" id="sc">Study these</button></h2><div class="card"><ul class="list">${cards.slice(0, 40).map(c => `<li><span class="name plain">${hilite(c.q, term)}<br><span class="mute">${hilite(c.a, term)}</span></span>${tag(c.lec)}</li>`).join('')}</ul></div>` : ''}
   ${lecs.length + qs.length + cards.length ? '' : '<div class="card empty" data-icon="?"><b>No match.</b><p class="mute">Try fewer or shorter words, or one keyword such as a drug or a disease name.</p></div>'}`;
  if ($('#sp')) $('#sp').onclick = () => startSession(qs.map(q => q.id), {mode: 'practice', label: 'Search: ' + term});
  if ($('#sc')) $('#sc').onclick = () => startCards(cards.map(c => c.id), 'Search: ' + term);
}
function vQuestion(r) {
  let q = byId[r.parts[0]];   // old address (#/q/<id>) still works; new one is #/q/<module>/<discipline>/<lecture>/<n>
  if (!q && r.parts.length === 4) { const lec = LECS.find(x => x.key === r.parts.slice(0, 3).join('/')); q = lec && lec.all[+r.parts[3] - 1]; }
  if (!q) return vNotFound();
  title('Question');
  const a = prog.a[q.id], l = q.lec;
  main.innerHTML = `${crumbs(l.b, l.d, l, 'Question')}
   <h1 class="sr">Question</h1><p class="mute small">${a ? 'Last answer ' + a.l + (a.ok ? ' (correct)' : ' (incorrect)') + ', ' + plural(a.n, 'attempt') : 'Not answered yet'}</p>
   <p class="stem">${esc(q.stem)}</p>${Object.entries(q.options).map(([k, v]) => `<div class="opt" data-k="${k}"><span class="k">${k}</span><span>${esc(v)}</span></div>`).join('')}
   <div class="row mt"><button type="button" class="btn" id="one">Answer this question</button><button type="button" class="btn ghost" id="show">Show answer</button>
   <button type="button" class="btn ghost flagbtn" id="fl" aria-pressed="${!!prog.f[q.id]}">⚑ ${prog.f[q.id] ? 'Flagged' : 'Flag'}</button></div><div id="ans"></div>`;
  $('#one').onclick = () => startSession([q.id], {mode: 'practice', label: l.title});
  $('#show').onclick = () => { $$('.opt').forEach(o => { if (o.dataset.k === q.answer) o.classList.add('right'); });
    $('#ans').innerHTML = `<div class="exp"><b>Answer: ${q.answer}</b>${fmtExp(q.explanation)}<div class="mute small">${esc(q.source)}</div></div>`; say('Answer: ' + q.answer); };
  $('#fl').onclick = () => { if (prog.f[q.id]) delete prog.f[q.id]; else prog.f[q.id] = 1; saveProg(); render(); };
}
function vSettings() {
  title('Settings');
  const n = Object.keys(prog.a).length, f = Object.keys(prog.f).length, c = Object.keys(prog.c).length, th = settings.theme || 'auto';
  main.innerHTML = `<h1>Settings</h1>${errorCard()}
   <div class="card"><fieldset class="checks"><legend>Appearance</legend>${['auto', 'light', 'dark'].map(t => `<label><input type="radio" name="th" value="${t}" ${th === t ? 'checked' : ''}> ${t === 'auto' ? 'Match device' : t[0].toUpperCase() + t.slice(1)}</label>`).join('')}</fieldset></div>
   ${setToggle({}) ? `<div class="card"><h2>Question set</h2>${setToggle({})}<p class="mute small">High-yield (short) keeps the most exam-relevant questions of a lecture; Full adds every detail. Lectures without a short set always show all their questions. Answers are remembered in both.</p></div>` : ''}<div class="card"><h2>Progress backup</h2><p class="mute">Progress lives only in this browser on this device: ${plural(n, 'answered question')}, ${f} flagged, ${plural(c, 'marked flashcard')}. Clearing browser data erases it, and another device or browser starts empty. Export a backup file to keep it or move it.</p>
    <div class="row"><button type="button" class="btn" id="exp1">Export progress (JSON)</button><label class="btn ghost" for="imp" tabindex="0" id="impL">Import progress…</label><input class="sr" type="file" id="imp" accept="application/json,.json">
    <button type="button" class="btn danger" id="reset">Reset progress…</button></div><p class="mute small" id="impMsg" role="status"></p></div>
   <div class="card"><h2>Keyboard shortcuts</h2><p class="checks"><label><input type="checkbox" id="keysOn" ${settings.keys === false ? '' : 'checked'}> Use single-key shortcuts in quizzes and flashcards</label></p>${keysHTML}</div>
   <div class="card"><h2>Privacy and offline use</h2><p class="mute">No accounts, cookies, analytics or outside requests. After one visit online the site also opens without a connection.</p>
    <p class="mute small">Loaded: ${LECS.length} lectures, ${Q.length} questions, ${C.length} flashcards. ${'serviceWorker' in navigator ? 'Offline copy: supported by this browser.' : 'Offline copy: not supported by this browser.'}${build.date ? ' Site updated ' + esc(build.date) + '.' : ''}</p>
    <p><a href="#/about">Help: how the site works</a></p></div>`;
  wireSet();
  $('#keysOn').onchange = e => { settings.keys = e.target.checked; write(K.set, settings); say('Shortcuts ' + (settings.keys ? 'on' : 'off')); };
  $$('input[name=th]').forEach(x => x.onchange = () => { settings.theme = x.value; write(K.set, settings); applyTheme(); });
  $('#exp1').onclick = () => download('study_progress_' + stamp() + '.json', {app: 'lau-qbank', version: 2,   /* internal file tag from the site's first name; kept so older backup files still import */ exported: new Date().toISOString(), progress: prog});
  $('#impL').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#imp').click(); } };
  $('#imp').onchange = async e => {
    const file = e.target.files[0], msg = $('#impMsg'); if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'lau-qbank' || !data.progress || typeof data.progress.a !== 'object') throw new Error('not a progress file from this site');
      const inc = cleanProg(data.progress), k = Object.keys(inc.a).length, kc = Object.keys(inc.c).length;
      const ok = await ask('Import progress?', `<p>The file holds ${plural(k, 'answered question')}, ${Object.keys(inc.f).length} flags and ${plural(kc, 'marked flashcard')}.</p><p class="checks"><label><input type="checkbox" id="mrg" checked> Merge with what is on this device (keep the newer entry for each item)</label></p><p class="mute small">Without merge, the file replaces the current progress.</p>`, 'Import');
      if (!ok) { msg.textContent = 'Import cancelled.'; e.target.value = ''; return; }
      if ($('#mrg') && $('#mrg').checked) {
        for (const [id, r] of Object.entries(inc.a)) if (!prog.a[id] || (prog.a[id].t || 0) < r.t) prog.a[id] = r;
        for (const [id, r] of Object.entries(inc.c)) if (!prog.c[id] || (prog.c[id].t || 0) < r.t) prog.c[id] = r;
        Object.assign(prog.f, inc.f);
        prog.h = prog.h.concat(inc.h.filter(h => !prog.h.some(x => x.t === h.t))).sort((a, b) => a.t - b.t).slice(-60);
      } else prog = inc;
      saveProg(); render(); $('#impMsg').textContent = 'Imported ' + k + ' answers and ' + kc + ' flashcard marks.';
    } catch (err) { msg.textContent = 'Import failed: ' + err.message + '. Nothing was changed.'; }
    e.target.value = '';
  };
  $('#reset').onclick = async () => {
    if (!(await ask('Erase all progress?', `<p>This removes ${n} answers, ${f} flags, ${c} flashcard marks and the session history from this device. It cannot be undone. Export a backup first if unsure.</p>`, 'Erase everything', true))) return;
    prog = blankProg(); ses = null; cs = null; saveProg(); saveSes(); saveCs(); render(); say('Progress erased');
  };
}
const keysHTML = `<p><b>Questions:</b> <kbd>A</kbd>–<kbd>E</kbd> or <kbd>1</kbd>–<kbd>5</kbd> choose an option · <kbd>Enter</kbd> or <kbd>→</kbd> next · <kbd>←</kbd> previous · <kbd>F</kbd> flag.</p>
    <p><b>Flashcards:</b> <kbd>Space</kbd> or <kbd>Enter</kbd> flip · <kbd>1</kbd> or <kbd>A</kbd> again · <kbd>2</kbd> or <kbd>D</kbd> known · <kbd>→</kbd> next · <kbd>←</kbd> previous.</p><p class="mute small">Keys pressed with ⌘, Ctrl or Alt are left to the browser.</p>`;
function vAbout() {
  title('Help');
  const short = LECS.some(hasShort);
  main.innerHTML = `<article class="prose help"><h1>Help</h1><p class="covers">A study site organised by lecture: a short summary, flashcards and exam-style questions for each one.</p>
   <section><h2>Studying a lecture</h2>${steps}<p>Lectures are grouped by module and discipline on the <a href="#/">home page</a>. A lecture that is still being written shows "Not written yet" for the missing part.</p></section>
   <section><h2>Questions</h2><ul>
    <li><b>Practice</b> shows the answer and an explanation for every option straight after you choose.</li>
    <li><b>Timed exam</b> hides the answers until you submit, with a countdown. You can change answers until then.</li>
    ${short ? '<li><b>High-yield (short)</b> is the default set: the most exam-relevant questions of a lecture. <b>Full</b> adds every detail. Switch at the top of any lecture or module; answers are remembered in both.</li>' : ''}
    <li><b>Custom quiz</b> (on the home, module and lecture pages) picks lectures, only unanswered / incorrect / flagged questions, question style, and how many.</li>
    <li><b>Flag</b> a question you want to see again. A quiz you leave half-way waits under Continue on the home page.</li></ul></section>
   <section><h2>After practicing</h2><ul>
    <li><a href="#/mistakes">Mistakes</a> collects every question whose latest answer was wrong. It leaves the list when you get it right.</li>
    <li><a href="#/stats">Stats</a> shows progress and accuracy per module, discipline and lecture, plus your recent sessions.</li>
    <li><a href="#/search">Search</a> looks through lecture titles, questions, explanations and flashcards.</li></ul></section>
   <section><h2>Your progress</h2><p>Progress is saved in this browser on this device only. There is no account and nothing is uploaded. Clearing the browser's site data erases it, and a second device starts empty.</p>
    <p>To keep a backup or move to another device, use <a href="#/settings">Settings</a> → Export progress, then Import on the other device.</p></section>
   <section><h2>Phone and offline use</h2><ul>
    <li><b>iPhone / iPad (Safari):</b> Share → Add to Home Screen.</li><li><b>Android (Chrome):</b> menu ⋮ → Add to Home screen or Install app.</li>
    <li>After one visit with a connection, the site also opens offline. New content appears the next time you open it online.</li></ul></section>
   <section><h2>Keyboard shortcuts</h2>${keysHTML}<p class="mute small">They can be switched off in <a href="#/settings">Settings</a>.</p></section>
   <section><h2>Privacy</h2><p>No accounts, cookies, adverts, analytics or requests to other websites.</p>${build.date ? `<p class="mute small">Site updated ${esc(build.date)}. ${LECS.length} lectures, ${LECS.reduce((n, l) => n + l.all.length, 0)} questions, ${C.length} flashcards.</p>` : ''}</section>
   <div class="next"><div class="row"><a class="btn" href="#/">Go to the lectures</a><a class="btn ghost" href="#/settings">Settings</a></div></div></article>`;
}
function vNotFound() { title('Not found'); main.innerHTML = `<h1>Page not found</h1><p class="sub">That page does not exist (a lecture may have been renamed).</p><div class="row"><a class="btn" href="#/">Home</a><a class="btn ghost" href="#/search">Search</a></div>`; }
/* ---------- theme, keys, offline ---------- */
function applyTheme() {
  const t = settings.theme;
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  const m = $('meta[name=theme-color]'); if (m) m.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f5f6fa');
}
applyTheme();
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
  settings.theme = dark ? 'light' : 'dark'; write(K.set, settings); applyTheme();
  if (route().name === 'settings') render();
};
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || dlg.open || settings.keys === false) return;
  const name = route().name, t = e.target, tag = t && t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const onControl = (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY');
  if (name === 'quiz' && ses && !ses.done) {
    const idx = k.length === 1 ? Math.max('abcde'.indexOf(k), '12345'.indexOf(k)) : -1;
    if (idx >= 0) { e.preventDefault(); pick(LET[idx]); }
    else if (k === 'Enter') {
      // Enter on a focused control keeps its normal meaning, except on an answer option, where it means "next"
      if (onControl && !(t.classList && t.classList.contains('opt'))) return;
      e.preventDefault(); move(1);
    }
    else if (k === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (k === 'f') { e.preventDefault(); toggleFlag(); }
  } else if (name === 'cards' && cs && cs.i < cs.ids.length) {
    if (k === ' ' || k === 'Enter') {
      if (onControl && t.id !== 'flash' && t.id !== 'cFlip') return;
      e.preventDefault(); flipCard();
    }
    else if (k === 'ArrowRight') { e.preventDefault(); moveCard(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveCard(-1); }
    else if ((k === '1' || k === 'a') && cs.flipped) { e.preventDefault(); markCard('again'); }
    else if ((k === '2' || k === 'd') && cs.flipped) { e.preventDefault(); markCard('known'); }
  }
});
const net = () => { $('#offline').hidden = navigator.onLine !== false; };
window.addEventListener('online', net); window.addEventListener('offline', net); net();
window.addEventListener('error', e => { if (!LECS.length) main.innerHTML = `<div class="card err" role="alert"><b>Something went wrong while starting.</b><p>${esc(e.message || '')}</p><p>Reload the page. Saved progress is not affected.</p></div>`; });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine !== false) { reg.update().catch(() => {}); checkUpdate(); } });
  }).catch(() => {});
}
/* A page left open keeps running the build it started with. When the published build is newer, offer a reload (never reload on our own: a quiz may be open). */
async function checkUpdate() {
  if (!build.version) return;
  try { const reg = await getJSON('data/registry.json'); if (reg.version && reg.version !== build.version) $('#update').hidden = false; } catch (e) { /* offline: nothing to do */ }
}
$('#updBtn').onclick = () => location.reload();

/* ---------- start ---------- */
loadData().then(() => { if (build.date) $('#built').textContent = ' · Updated ' + build.date; lastRoute = route().name + '/' + route().parts.join('/'); render(); document.documentElement.setAttribute('data-ready', '1'); })
  .catch(err => { main.innerHTML = `<div class="card err" role="alert"><b>The lecture list could not be loaded.</b><p>${esc(err.message)}</p><p>Check the connection and reload. Opening index.html straight from a folder does not work; use the website address (or a local web server).</p></div>`; document.documentElement.setAttribute('data-ready', 'error'); });
})();
