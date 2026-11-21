/* Kanji SRS – static, runs on GitHub Pages. Progress lives in localStorage. */
const STORE_KEY = 'kanjiSRS.v1';
const LEARN_BATCH = 5;
const $app = document.getElementById('app');
const $crumb = document.getElementById('crumb');

let decks = [];            // [{id,name,cards:[...]}]
let cardIndex = {};        // id -> {card, deckId}
let state = loadState();   // {decks:{deckId:{cards:{id:{...}}}}, selected:'all'|deckId}
let session = null;

/* ---------- storage ---------- */
function loadState() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.decks) return s; } catch (e) {}
  return { decks: {}, selected: 'all' };
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { alert('Could not save progress (storage full or blocked).'); } }
function deckState(id) { return (state.decks[id] ||= { cards: {} }); }
function cs(id) { const d = cardIndex[id]; return d ? deckState(d.deckId).cards[id] : null; }

/* ---------- time ---------- */
function today() { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
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
const speakBtn = t => `<button class="speak" title="Listen" onclick='speak(${JSON.stringify(t).replace(/'/g, '&#39;')})'>🔊</button>`;
const scopeDecks = () => state.selected === 'all' ? decks : decks.filter(d => d.id === state.selected);

/* ---------- card face ---------- */
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
    if (s.learning) { r.learning++; r.due++; }
    else { (s.ivl >= 21 ? r.mature++ : r.young++); if (s.due <= t) r.due++; }
  }
  return r;
}
function totals(list) {
  return list.map(deckStats).reduce((a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; return a; }, {});
}
function dueIds(list) {
  const t = today(), out = [];
  for (const d of list) { const st = deckState(d.id).cards;
    for (const c of d.cards) { const s = st[c.id]; if (s && (s.learning || s.due <= t)) out.push(c.id); } }
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

/* ---------- scheduling (SM-2 style, like Anki) ---------- */
function nextIvl(s, rating) {
  const ease = s.ease || 2.5, ivl = s.ivl || 1;
  if (rating === 'hard') return Math.max(ivl + 1, Math.round(ivl * 1.2));
  if (rating === 'good') return Math.max(ivl + 1, Math.round(ivl * ease));
  return Math.max(ivl + 2, Math.round(ivl * ease * 1.3));
}
function fmtIvl(d) { return d < 30 ? d + 'd' : d < 365 ? (d / 30).toFixed(1).replace('.0', '') + 'mo' : (d / 365).toFixed(1).replace('.0', '') + 'y'; }
function previewLabels(s) {
  if (s.learning) return { again: 'soon', good: '1d', easy: '4d' };
  return { again: 'soon', hard: fmtIvl(nextIvl(s, 'hard')), good: fmtIvl(nextIvl(s, 'good')), easy: fmtIvl(nextIvl(s, 'easy')) };
}
function applyRating(s, rating, failedBefore) {
  const t = today();
  if (rating === 'again') return; // handled by caller
  if (s.learning) {
    s.learning = false; s.ease = 2.5; s.reps = 1;
    s.ivl = rating === 'easy' ? 4 : 1; s.due = t + s.ivl; s.last = t; return;
  }
  if (failedBefore) return; // already relapsed this session; schedule stays at the lapse interval
  s.ease = Math.min(3.0, Math.max(1.3, (s.ease || 2.5) + (rating === 'hard' ? -0.15 : rating === 'easy' ? 0.15 : 0)));
  s.ivl = nextIvl({ ivl: s.ivl, ease: s.ease }, rating); // ease already adjusted; interval uses new ease
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
  const list = scopeDecks(), tot = totals(list), due = dueIds(list).length, intro = introducedIds(list).length;
  const canLearn = nextNew(list, 1).length > 0;
  const pct = n => tot.total ? (n / tot.total * 100) : 0;
  $app.innerHTML = `
    <div class="panel">
      <div class="row between">
        <label>Deck: <select id="deckSel">
          <option value="all"${state.selected === 'all' ? ' selected' : ''}>All decks (${decks.length})</option>
          ${decks.map(d => `<option value="${esc(d.id)}"${state.selected === d.id ? ' selected' : ''}>${esc(d.name)} · ${d.cards.length}</option>`).join('')}
        </select></label>
      </div>
    </div>

    <div class="grid">
      <div class="stat"><b>${due}</b><span>due now</span></div>
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
        Learn ${LEARN_BATCH} new<small>${canLearn ? 'Meet new words, then a quick check' : 'Everything has been introduced'}</small></button>
      <button class="btn primary big action" id="reviewBtn" ${due ? '' : 'disabled'}>
        Reviews (${due})<small>${intro ? (due ? 'Counts toward your schedule' : 'Nothing due right now') : 'Learn some words first'}</small></button>
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
  document.getElementById('reviewBtn').onclick = () => startReview(dueIds(list), 'Reviews');
  document.getElementById('studyBtn').onclick = studySetup;
  document.getElementById('exportBtn').onclick = exportProgress;
  document.getElementById('importBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = importProgress;
  document.getElementById('resetBtn').onclick = resetSelected;
}

/* ----- learn: present 5 new, then quiz them ----- */
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
    <div class="progress"><i style="width:${(s.i) / s.ids.length * 100}%"></i></div>
    <div class="flash">
      <span class="badge">NEW</span>
      <div class="word">${esc(c.word)} ${speakBtn(c.word)}</div>
      ${backHTML(c)}
    </div>
    <div class="row between">
      <button class="btn" id="prev" ${s.i ? '' : 'disabled'}>← Back</button>
      <button class="btn primary" id="next">${s.i === s.ids.length - 1 ? 'Start quick check →' : 'Next →'}</button>
    </div>
    <p class="hint">Read the word, reading, meaning and example. You'll be quizzed on these ${s.ids.length} next.</p>`;
  document.getElementById('prev').onclick = () => { s.i--; renderLearn(); };
  document.getElementById('next').onclick = () => {
    if (s.i < s.ids.length - 1) { s.i++; renderLearn(); return; }
    const t = today();
    for (const id2 of s.ids) { const d = cardIndex[id2];
      deckState(d.deckId).cards[id2] ||= { learning: true, ease: 2.5, ivl: 0, due: t, reps: 0, lapses: 0, introduced: t }; }
    save();
    startReview(s.ids, 'Quick check', true);
  };
}

/* ----- review runner (also used for the post-learn quick check) ----- */
function startReview(ids, label, afterLearn) {
  if (!ids.length) return home();
  session = { type: 'review', label, queue: shuffle(ids), failed: new Set(), done: 0, total: ids.length, show: false, afterLearn: !!afterLearn };
  renderReview();
}
function renderReview() {
  const s = session;
  if (!s.queue.length) return reviewDone();
  const id = s.queue[0], c = cardIndex[id].card, st = cs(id);
  setCrumb(`${s.label} · ${s.queue.length} left`);
  const pl = previewLabels(st);
  const btns = [['again', 'Again', pl.again, '1'], ...(st.learning ? [] : [['hard', 'Hard', pl.hard, '2']]),
    ['good', 'Good', pl.good, st.learning ? '2' : '3'], ['easy', 'Easy', pl.easy, st.learning ? '3' : '4']];
  $app.innerHTML = `
    <div class="progress"><i style="width:${s.done / s.total * 100}%"></i></div>
    <div class="flash">
      ${st.learning ? '<span class="badge">NEW</span>' : s.failed.has(id) ? '<span class="badge alt">RELEARN</span>' : ''}
      <div class="word">${esc(c.word)}</div>
      ${s.show ? backHTML(c) : '<p class="muted">What does it mean? How is it read?</p>'}
    </div>
    ${s.show
      ? `<div class="rate">${btns.map(b => `<button class="${b[0]}" data-r="${b[0]}">${b[1]}<small>${b[2]} · ${b[3]}</small></button>`).join('')}</div>`
      : `<button class="btn primary big" style="width:100%" id="show">Show answer <small>(space)</small></button>`}`;
  if (!s.show) document.getElementById('show').onclick = () => { s.show = true; renderReview(); };
  else document.querySelectorAll('.rate button').forEach(b => b.onclick = () => rate(b.dataset.r));
}
function rate(r) {
  const s = session, id = s.queue.shift(), st = cs(id), wasFailed = s.failed.has(id);
  if (r === 'again') {
    if (!wasFailed) { applyLapse(st); s.failed.add(id); }
    s.queue.push(id);
  } else {
    applyRating(st, r, wasFailed);
    s.done++;
  }
  save(); s.show = false; renderReview();
}
function reviewDone() {
  const s = session;
  setCrumb('Done');
  $app.innerHTML = `<div class="panel" style="text-align:center">
    <h2 style="margin-top:0">${s.afterLearn ? 'Nice — new words learned!' : 'Reviews complete!'}</h2>
    <p class="muted">${s.afterLearn ? 'They will come back in your reviews tomorrow.' : `You reviewed ${s.total} card${s.total === 1 ? '' : 's'}.`}</p>
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
    session = { type: 'study', ids, i: 0, show: document.getElementById('showAll').checked, showAll: document.getElementById('showAll').checked };
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
      state = s; state.selected ||= 'all'; save(); home();
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
  if (!session || e.target.tagName === 'SELECT' || e.metaKey || e.ctrlKey) return;
  const click = id => { const el = document.getElementById(id); if (el && !el.disabled) { el.click(); e.preventDefault(); } };
  if (session.type === 'review') {
    if (!session.show) { if (e.key === ' ' || e.key === 'Enter') click('show'); return; }
    const st = cs(session.queue[0]); if (!st) return;
    const map = st.learning ? { 1: 'again', 2: 'good', 3: 'easy' } : { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
    if (map[e.key]) { e.preventDefault(); rate(map[e.key]); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); rate('good'); }
  } else if (session.type === 'study') {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { session.show || !document.getElementById('reveal') ? click('next') || click('finish') : click('reveal'); }
    else if (e.key === 'ArrowLeft') click('prev');
  } else if (session.type === 'learn') {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') click('next');
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
