/* Kanji SRS – static, runs on GitHub Pages. Progress lives in localStorage. */
const STORE_KEY = 'kanjiSRS.v1';
const LEARN_BATCH = 5;
const DIRS = ['je', 'ej'];   // je: Japanese -> type English, ej: English -> type Japanese
const $app = document.getElementById('app');
const $crumb = document.getElementById('crumb');

let decks = [];            // [{id,name,cards:[...]}]
let cardIndex = {};        // id -> {card, deckId}
let state = loadState();   // {decks:{deckId:{cards:{id:{introduced,je:{},ej:{}}}}}, selected}
let session = null;

/* ---------- storage ---------- */
function freshDir(t) { return { learning: true, ease: 2.5, ivl: 0, due: t, reps: 0, lapses: 0 }; }
function loadState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
  if (!s || !s.decks) return { decks: {}, selected: 'all' };
  // migrate older saves (single-direction cards) to two directions
  const t = today();
  for (const d of Object.values(s.decks)) for (const c of Object.values(d.cards |a| {})) {
    if (!c.je) {
      const { learning, ease, ivl, due, reps, lapses } = c;
      c.je = { learning: !!learning, ease: ease || 2.5, ivl: ivl || 0, due: due ?? t, reps: reps || 0, lapses: lapses || 0 };
      c.ej = freshDir(t);
    }
  }
  return s;
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { alert('Could not save progress (storage full or blocked).'); } }
function deckState(id) { return (state.decks[id] ||= { cards: {} }); }
function cardState(id) { const d = cardIndex[id]; return d ? deckState(d.deckId).cards[id] : null; }
const parseKey = k => { const [id, dir] = k.split('|'); return { id, dir }; };
const dirState = k => { const { id, dir } = parseKey(k); return cardState(id)[dir]; };

/* ---------- time ---------- */
function today() { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function separateSiblings(keys) {            // avoid the same word's two directions back-to-back
  const a = keys.slice();
  for (let i = 1; i < a.length; i++) {
    if (parseKey(a[i]).id === parseKey(a[i - 1]).id) {
      const j = a.findIndex((k, x) => x > i && parseKey(k).id !== parseKey(a[i - 1]).id && (i + 1 >= a.length || parseKey(k).id !== parseKey(a[i + 1] || '|').id));
      if (j > -1) [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}
function highlight(sentence, word) {
  const s = esc(sentence), w = esc(word);
  return w && s.includes(w) ? s.replace(w, `<mark>${w}</mark>`) : s;
}
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ''));
  u.lang = 'ja-JP'; u.rate = 0.9; speechSynthesis.speak(u);
}
window.speak = speak;
const speakBtn = t => `<button class="speak" type="button" title="Listen" onclick='speak(${JSON.stringify(t).replace(/'/g, '&#39;')})'>🔊</button>`;
const scopeDecks = () => state.selected === 'all' ? decks : decks.filter(d => d.id === state.selected);

/* ---------- answer checking ---------- */
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function splitTop(s, re) {                     // split on separators that are outside parentheses
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && re.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function normEn(s) {
  s = s.toLowerCase().normalize('NFKC').replace(/[~〜～]/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(to|a|an|the) /, '').replace(/^be /, '');
  return s.trim();
}
function enVariants(eng) {
  const set = new Set();
  const add = x => { const n = normEn(x); if (n.length > 1) set.add(n); };
  add(eng.replace(/\(([^)]*)\)/g, '$1'));
  for (const part of splitTop(eng, /[;,\/]/)) {
    add(part.replace(/\([^)]*\)/g, ' '));
    add(part.replace(/\(([^)]*)\)/g, '$1'));
    add(part.replace(/\([^)]*\)/g, ' ').replace(/\betc\b/g, ''));
  }
  return [...set];
}
function checkEnglish(typed, card) {
  const alts = enVariants(card.english);
  const pieces = [typed, ...typed.split(/[;,\/]/)].map(normEn).filter(Boolean);
  let close = false;
  for (const p of pieces) for (const a of alts) {
    if (p === a) return { ok: true };
    const tol = a.length >= 10 ? 2 : a.length >= 5 ? 1 : 0;
    if (tol && lev(p, a) <= tol) close = true;
  }
  return close ? { ok: true, note: 'Accepted — small typo' } : { ok: false };
}
const normJa = s => s.normalize('NFKC').replace(/[\s〜～~]/g, '');
function jaVariants(s) {
  s = normJa(s); const set = new Set();
  set.add(s.replace(/[()]/g, ''));                // keep bracket contents
  set.add(s.replace(/\([^)]*\)/g, ''));           // drop brackets entirely
  const m = s.match(/^(.*)\(([^)]+)\)$/);         // alternative spelling in trailing brackets
  if (m && m[2] !== 'する') set.add(m[2]);
  set.delete(''); return [...set];
}
function checkJapanese(typed, card) {
  const t = normJa(typed).replace(/[()]/g, '');
  if (!t) return { ok: false };
  const word = jaVariants(card.word), reading = jaVariants(card.reading);
  if (word.includes(t)) return { ok: true };
  if (reading.includes(t)) return { ok: true, note: 'Accepted — reading (the written form is shown below)' };
  return { ok: false };
}

/* ---------- card faces ---------- */
function exampleHTML(c) {
  if (!c.sentenceJa) return '';
  return `<div class="example"><div class="lbl">Example sentence</div>
    <div class="ja">${highlight(c.sentenceJa, c.word)} ${speakBtn(c.sentenceJa)}</div>
    <div class="en">${esc(c.sentenceEn)}</div></div>`;
}
function backHTML(c) {
  return `<div class="reading">${esc(c.reading)} ${speakBtn(c.word)}</div>
    <div class="english">${esc(c.english)}</div>
    ${c.pos ? `<span class="pos">${esc(c.pos)}</span>` : ''}
    ${exampleHTML(c)}`;
}

/* ---------- queues & stats ---------- */
function deckStats(deck) {
  const st = deckState(deck.id).cards, t = today();
  const r = { total: deck.cards.length, unseen: 0, learning: 0, young: 0, mature: 0, due: 0, introduced: 0 };
  for (const c of deck.cards) {
    const s = st[c.id];
    if (!s) { r.unseen++; continue; }
    r.introduced++;
    const ds = DIRS.map(d => s[d]);
    for (const d of ds) if (d.learning || d.due <= t) r.due++;
    if (ds.some(d => d.learning)) r.learning++;
    else if (Math.min(...ds.map(d => d.ivl)) >= 21) r.mature++; else r.young++;
  }
  return r;
}
function totals(list) {
  return list.map(deckStats).reduce((a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }, {});
}
function dueKeys(list) {
  const t = today(), out = [];
  for (const d of list) { const st = deckState(d.id).cards;
    for (const c of d.cards) { const s = st[c.id]; if (!s) continue;
      for (const dir of DIRS) if (s[dir].learning || s[dir].due <= t) out.push(c.id + '|' + dir); } }
  return out;
}
function introducedIds(list) {
  const out = [];
  for (const d of list) { const st = deckState(d.id).cards; for (const c of d.cards) if (st[c.id]) out.push(c.id); }
  return out;
}
function nextNew(list, n) {
  const out = [];
  for (const d of list) { const st = deckState(d.id).cards;
    for (const c of d.cards) { if (!st[c.id]) { out.push(c.id); if (out.length >= n) return out; } } }
  return out;
}

/* ---------- scheduling (SM-2 style) ---------- */
function applyCorrect(s, failedBefore) {
  const t = today();
  if (s.learning) { s.learning = false; s.ease = 2.5; s.reps = 1; s.ivl = 1; s.due = t + 1; s.last = t; return; }
  if (failedBefore) return;   // already lapsed this session; keep the lapse interval
  s.ivl = Math.max(s.ivl + 1, Math.round(s.ivl * s.ease));
  s.reps = (s.reps || 0) + 1; s.due = t + s.ivl; s.last = t;
}
function applyLapse(s) {
  if (s.learning) return;
  s.lapses = (s.lapses || 0) + 1;
  s.ease = Math.max(1.3, (s.ease || 2.5) - 0.2);
  s.ivl = 1; s.due = today() + 1; s.last = today();
}

/* ---------- views ---------- */
function setCrumb(t) { $crumb.textContent = t || ''; }

function home() {
  session = null; setCrumb('');
  const list = scopeDecks(), tot = totals(list), due = dueKeys(list).length, intro = introducedIds(list).length;
  const canLearn = nextNew(list, 1).length > 0;
  const pct = n => tot.total ? (n / tot.total * 100) : 0;
  $app.innerHTML = `
    <div class="panel">
      <label>Deck: <select id="deckSel">
        <option value="all"${state.selected === 'all' ? ' selected' : ''}>All decks (${decks.length})</option>
        ${decks.map(d => `<option value="${esc(d.id)}"${state.selected === d.id ? ' selected' : ''}>${esc(d.name)} · ${d.cards.length}</option>`).join('')}
      </select></label>
    </div>

    <div class="grid">
      <div class="stat"><b>${due}</b><span>reviews due now</span></div>
      <div class="stat"><b>${tot.unseen}</b><span>not yet learned</span></div>
      <div class="stat"><b>${intro}</b><span>learned so far</span></div>
    </div>
    <div class="panel">
      <div class="bar">
        <i style="width:${pct(tot.mature)}%;background:var(--good)"></i>
        <i style="width:${pct(tot.young)}%;background:var(--easy)"></i>
        <i style="width:${pct(tot.learning)}%;background:var(--hard)"></i>
      </div>
      <div class="legend">
        <span style="--c:var(--good)">Mature ${tot.mature}</span>
        <span style="--c:var(--easy)">Young ${tot.young}</span>
        <span style="--c:var(--hard)">Learning ${tot.learning}</span>
        <span style="--c:var(--line)">New ${tot.unseen}</span>
      </div>
    </div>

    <h2>Study</h2>
    <div class="row">
      <button class="btn primary big action" id="learnBtn" ${canLearn ? '' : 'disabled'}>
        Learn ${LEARN_BATCH} new<small>${canLearn ? 'Meet the words, quick check, then reviews start right away' : 'Everything has been introduced'}</small></button>
      <button class="btn primary big action" id="reviewBtn" ${due ? '' : 'disabled'}>
        Reviews (${due})<small>${intro ? (due ? 'Type the answers · counts toward your schedule' : 'Nothing due right now') : 'Learn some words first'}</small></button>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn big action" id="studyBtn" ${intro ? '' : 'disabled'}>
        Free study<small>${intro ? `All ${intro} learned words · doesn't affect reviews` : 'Unlocks after your first 5 words'}</small></button>
    </div>

    <h2>Progress backup</h2>
    <div class="panel small">
      <p class="muted" style="margin-top:0">Progress is saved in this browser only. Export a backup to move devices or keep it safe.</p>
      <div class="row">
        <button class="btn" id="exportBtn">Export</button>
        <button class="btn" id="importBtn">Import</button>
        <button class="btn link" id="resetBtn">Reset selected deck</button>
        <input type="file" id="importFile" accept="application/json" hidden>
      </div>
    </div>`;
  document.getElementById('deckSel').onchange = e => { state.selected = e.target.value; save(); home(); };
  document.getElementById('learnBtn').onclick = startLearn;
  document.getElementById('reviewBtn').onclick = () => startReview(dueKeys(list), 'Reviews');
  document.getElementById('studyBtn').onclick = studySetup;
  document.getElementById('exportBtn').onclick = exportProgress;
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = importProgress;
  document.getElementById('resetBtn').onclick = resetSelected;
}

/* ----- learn: present 5 new -> typed quick check -> reviews start immediately ----- */
function startLearn() {
  const ids = nextNew(scopeDecks(), LEARN_BATCH);
  if (!ids.length) return;
  session = { type: 'learn', ids, i: 0 };
  renderLearn();
}
function renderLearn() {
  const s = session, id = s.ids[s.i], c = cardIndex[id].card;
  setCrumb(`Learn · ${s.i + 1}/${s.ids.length}`);
  $app.innerHTML = `
    <div class="progress"><i style="width:${s.i / s.ids.length * 100}%"></i></div>
    <div class="flash">
      <span class="badge">NEW</span>
      <div class="word">${esc(c.word)} ${speakBtn(c.word)}</div>
      ${backHTML(c)}
    </div>
    <div class="row between">
      <button class="btn" id="prev" ${s.i ? '' : 'disabled'}>← Back</button>
      <button class="btn primary" id="next">${s.i === s.ids.length - 1 ? 'Start quick check →' : 'Next →'}</button>
    </div>
    <p class="hint">Read the word, reading, meaning and example. You'll type the meanings next, then reviews begin straight away.</p>`;
  document.getElementById('prev').onclick = () => { s.i--; renderLearn(); };
  document.getElementById('next').onclick = () => {
    if (s.i < s.ids.length - 1) { s.i++; renderLearn(); return; }
    const t = today();
    for (const id2 of s.ids) { const d = cardIndex[id2];
      deckState(d.deckId).cards[id2] ||= { introduced: t, je: freshDir(t), ej: freshDir(t) }; }
    save();
    startReview(s.ids.map(i => i + '|je'), 'Quick check', { check: true, learnedIds: s.ids });
  };
}

/* ----- typed review runner (also used for the quick check) ----- */
function startReview(keys, label, opts = {}) {
  if (!keys.length) return home();
  session = {
    type: 'review', label, check: !!opts.check, afterLearn: !!opts.afterLearn,
    learnedIds: opts.learnedIds || [],
    queue: separateSiblings(shuffle(keys)), failed: new Set(), done: 0, total: keys.length,
    stage: 'ask', pending: null,
  };
  renderReview();
}
function renderReview() {
  const s = session;
  if (!s.queue.length) return reviewDone();
  const key = s.queue[0], { id, dir } = parseKey(key), c = cardIndex[id].card, st = dirState(key);
  setCrumb(`${s.label} · ${s.queue.length} left`);
  const isJe = dir === 'je';
  const badge = st.learning && !s.check ? '<span class="badge">NEW</span>' : s.failed.has(key) ? '<span class="badge alt">RETRY</span>' : '';
  const prompt = isJe
    ? `<div class="tag">Japanese → English</div><div class="word">${esc(c.word)}</div>`
    : `<div class="tag">English → Japanese</div><div class="english big">${esc(c.english)}</div>${c.pos ? `<span class="pos">${esc(c.pos)}</span>` : ''}`;
  let body;
  if (s.stage === 'ask') {
    body = `<form id="f" autocomplete="off" class="answer">
        <input id="ans" type="text" ${isJe ? 'lang="en" placeholder="Type the English meaning"' : 'lang="ja" placeholder="Type the Japanese (kanji or kana)"'}
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn primary" type="submit">Check</button>
      </form>
      <p class="hint">${isJe ? 'Any one accepted meaning is fine.' : 'Kanji or kana both count. Press Enter to check.'}</p>`;
  } else {
    const p = s.pending;
    body = `<div class="result ${p.ok ? 'ok' : 'bad'}">
        <b>${p.ok ? '✔ Correct' : '✘ Not quite'}</b>${p.note ? ` <span class="small">· ${esc(p.note)}</span>` : ''}
        ${p.typed ? `<div class="small">You typed: <span class="typed">${esc(p.typed)}</span></div>` : '<div class="small">No answer entered.</div>'}
      </div>
      <div class="reveal">
        ${isJe ? '' : `<div class="word med">${esc(c.word)} ${speakBtn(c.word)}</div>`}
        ${backHTML(c)}
      </div>
      <div class="row between" style="margin-top:10px">
        ${p.ok ? '<span></span>' : '<button class="btn link" id="override" type="button">I was actually right</button>'}
        <button class="btn primary big" id="cont" type="button">Continue <small>(Enter)</small></button>
      </div>`;
  }
  $app.innerHTML = `
    <div class="progress"><i style="width:${s.done / s.total * 100}%"></i></div>
    <div class="flash typed-card">${badge}${prompt}${body}</div>`;
  if (s.stage === 'ask') {
    const input = document.getElementById('ans');
    document.getElementById('f').onsubmit = e => { e.preventDefault(); submitAnswer(input.value.trim()); };
    input.addEventListener('keydown', e => { if (e.isComposing || e.keyCode === 229) e.stopPropagation(); });
    setTimeout(() => input.focus(), 0);
  } else {
    document.getElementById('cont').onclick = continueReview;
    const o = document.getElementById('override');
    if (o) o.onclick = () => { s.pending.ok = true; s.pending.note = 'Marked correct by you'; renderReview(); };
  }
}
function submitAnswer(typed) {
  const s = session, { id, dir } = parseKey(s.queue[0]), c = cardIndex[id].card;
  const res = typed ? (dir === 'je' ? checkEnglish(typed, c) : checkJapanese(typed, c)) : { ok: false };
  s.pending = { typed, ok: res.ok, note: res.note || '' };
  s.stage = 'feedback'; renderReview();
}
function continueReview() {
  const s = session, key = s.queue.shift(), p = s.pending, st = dirState(key), wasFailed = s.failed.has(key);
  if (p.ok) {
    if (!s.check) applyCorrect(st, wasFailed);
    s.done++;
  } else {
    if (!s.check && !wasFailed) applyLapse(st);
    s.failed.add(key);
    s.queue.push(key);
  }
  if (!s.check) save();
  s.stage = 'ask'; s.pending = null;
  if (s.check && !s.queue.length) {            // quick check finished -> reviews begin right now
    const keys = dueKeys(scopeDecks());
    return startReview(keys, 'Reviews', { afterLearn: true, learnedIds: s.learnedIds });
  }
  renderReview();
}
function reviewDone() {
  const s = session;
  setCrumb('Done');
  $app.innerHTML = `<div class="panel" style="text-align:center">
    <h2 style="margin-top:0">${s.afterLearn ? 'Nice — new words learned and reviewed!' : 'Reviews complete!'}</h2>
    <p class="muted">${s.afterLearn ? "They'll come back in your reviews tomorrow." : `You answered ${s.total} review${s.total === 1 ? '' : 's'}.`}</p>
    <div class="row" style="justify-content:center">
      ${s.afterLearn && nextNew(scopeDecks(), 1).length ? '<button class="btn primary" id="more">Learn 5 more</button>' : ''}
      <button class="btn" id="goHome">Home</button></div></div>`;
  const more = document.getElementById('more'); if (more) more.onclick = startLearn;
  document.getElementById('goHome').onclick = home;
}

/* ----- free study (no scheduling impact) ----- */
function studySetup() {
  const list = scopeDecks(), n = introducedIds(list).length;
  setCrumb('Free study');
  $app.innerHTML = `
    <h2>Free study</h2>
    <div class="panel opts">
      <p style="margin-top:0">All <b>${n}</b> words you've learned so far${state.selected === 'all' ? '' : ' in this deck'}. This session <b>does not</b> count toward reviews or change any schedule.</p>
      <label><input type="radio" name="ord" value="shuffle" checked> Shuffled</label>
      <label><input type="radio" name="ord" value="order"> In order</label>
      <hr style="border:0;border-top:1px solid var(--line)">
      <label><input type="checkbox" id="showAll"> Show full answer immediately (no flip)</label>
      <div class="row" style="margin-top:14px">
        <button class="btn primary big" id="go">Start</button>
        <button class="btn" id="cancel">Cancel</button></div>
    </div>`;
  document.getElementById('cancel').onclick = home;
  document.getElementById('go').onclick = () => {
    let ids = introducedIds(list);
    if (document.querySelector('input[name=ord]:checked').value === 'shuffle') ids = shuffle(ids);
    const all = document.getElementById('showAll').checked;
    session = { type: 'study', ids, i: 0, show: all, showAll: all };
    renderStudy();
  };
}
function renderStudy() {
  const s = session, id = s.ids[s.i], c = cardIndex[id].card;
  setCrumb(`Free study · ${s.i + 1}/${s.ids.length}`);
  $app.innerHTML = `
    <div class="progress"><i style="width:${(s.i + 1) / s.ids.length * 100}%"></i></div>
    <div class="flash">
      <span class="badge alt">STUDY</span>
      <div class="word">${esc(c.word)}</div>
      ${s.show ? backHTML(c) : '<p class="muted">Tap to reveal reading, meaning and example</p>'}
    </div>
    <div class="row between">
      <button class="btn" id="prev" ${s.i ? '' : 'disabled'}>← Prev</button>
      ${s.show ? '' : '<button class="btn primary" id="reveal">Show answer</button>'}
      ${s.i < s.ids.length - 1 ? '<button class="btn primary" id="next">Next →</button>' : '<button class="btn primary" id="finish">Finish</button>'}
    </div>`;
  const go = d => { s.i += d; s.show = s.showAll; renderStudy(); };
  document.getElementById('prev').onclick = () => go(-1);
  const nx = document.getElementById('next'); if (nx) nx.onclick = () => go(1);
  const fin = document.getElementById('finish'); if (fin) fin.onclick = home;
  const rv = document.getElementById('reveal'); if (rv) rv.onclick = () => { s.show = true; renderStudy(); };
}

/* ----- backup ----- */
function exportProgress() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `kanji-srs-progress-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importProgress(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!s || typeof s.decks !== 'object') throw 0;
      if (!confirm('Replace your current progress with this backup?')) return;
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
      state = loadState(); state.selected ||= 'all'; save(); home();
    } catch (_) { alert('That file is not a valid progress backup.'); }
  };
  r.readAsText(f);
}
function resetSelected() {
  const list = scopeDecks();
  const names = state.selected === 'all' ? 'ALL decks' : list[0].name;
  if (!confirm(`Erase all progress for ${names}? This cannot be undone.`)) return;
  for (const d of list) delete state.decks[d.id];
  save(); home();
}

/* ----- keyboard ----- */
document.addEventListener('keydown', e => {
  if (!session || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey) return;
  const tag = e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT') return;
  const click = id => { const el = document.getElementById(id); if (el && !el.disabled) { el.click(); e.preventDefault(); return true; } return false; };
  if (session.type === 'review') {
    if (session.stage === 'feedback' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); continueReview(); }
  } else if (session.type === 'study') {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); click('reveal') || click('next') || click('finish'); }
    else if (e.key === 'ArrowLeft') click('prev');
  } else if (session.type === 'learn') {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); click('next'); }
    else if (e.key === 'ArrowLeft') click('prev');
  }
});
document.getElementById('homeBtn').onclick = () => { if (!session || session.type === 'study' || confirm('Leave this session? Answered cards are already saved.')) home(); };

/* ---------- boot ---------- */
async function boot() {
  try {
    const manifest = await (await fetch('data/manifest.json', { cache: 'no-cache' })).json();
    decks = await Promise.all(manifest.map(async m => {
      const d = await (await fetch('data/' + m.file, { cache: 'no-cache' })).json();
      return { id: d.id, name: d.name || m.name, cards: d.cards };
    }));
    for (const d of decks) for (const c of d.cards) cardIndex[c.id] = { card: c, deckId: d.id };
    if (state.selected !== 'all' && !decks.some(d => d.id === state.selected)) state.selected = 'all';
    home();
  } catch (err) {
    $app.innerHTML = `<div class="panel"><b>Couldn't load decks.</b><p class="muted">If you opened index.html directly from disk, browsers block loading the JSON files. Run <code>python -m http.server</code> in this folder and open <code>http://localhost:8000</code>, or use GitHub Pages.</p><pre class="small">${esc(err)}</pre></div>`;
  }
}
boot();
