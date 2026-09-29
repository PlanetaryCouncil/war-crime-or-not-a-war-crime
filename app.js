import { EloPool, replay, pairKey } from './lib/elo.js';
import { condemnLevel, MAX_LEVEL } from './lib/condemn.js';
import { makeStore } from './lib/store.js';
import { API_BASE, COMPARISONS_PER_SESSION } from './config.js';
import { incidents, headlines, bbcContext, SOURCES_CHECKED } from './data/dataset.js';

const store = makeStore(API_BASE);
const byId = new Map(incidents.map((x) => [x.id, x]));
const $ = (s) => document.querySelector(s);
// ?n=5 shortens a session (used by the simulated visitor and for demos).
const COMPARISONS = Number(new URLSearchParams(location.search).get('n')) || COMPARISONS_PER_SESSION;
const NEW_FOR_MS = 7 * 24 * 3600 * 1000; // a submission counts as "new" for a week

const SCALE = [
  { v: -2, label: 'Strongly downplays' },
  { v: -1, label: 'Somewhat downplays' },
  { v: 0, label: 'Fair' },
  { v: 1, label: 'Somewhat overstates' },
  { v: 2, label: 'Strongly overstates' },
];
const TAGS = [
  'Hides who did it (passive voice)',
  "'Died' where 'killed' fits",
  'Leads with one side’s claim',
  'Asymmetric language between sides',
  'Presents allegation as fact',
  'Omits key context',
  'Accurate and clear',
];

// Session state
let session;
function newSession() {
  const order = shuffle(headlines.map((h) => h.id));
  const half = Math.ceil(order.length / 2);
  session = {
    pid: crypto.randomUUID(),
    pre: order.slice(0, half),
    post: order.slice(half),
    phase: 'pre',
    i: 0,
    compares: 0,
    recent: [],
    pool: null,
  };
}

// ---------- routing ----------
function show(id) {
  document.querySelectorAll('.stage').forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
  if (id === 'results') renderResults();
}
document.querySelectorAll('[data-go]').forEach((b) =>
  b.addEventListener('click', (e) => { e.preventDefault(); show(b.dataset.go); }));

$('#begin').addEventListener('click', async () => {
  newSession();
  session.pool = await livePool();
  nextHeadline();
});
// Another round skips the headlines: each person rates them once, or the before/after split breaks.
$('#again').addEventListener('click', async () => {
  if (!session) return $('#begin').click();
  session.pool = await livePool();
  Object.assign(session, { phase: 'extra', compares: 0 });
  nextPair();
});

// ---------- headline rating ----------
let pick = null;
function nextHeadline() {
  const list = session[session.phase];
  if (session.i >= list.length) {
    if (session.phase === 'pre') { session.phase = 'compare'; return nextPair(); }
    return show('results');
  }
  const h = headlines.find((x) => x.id === list[session.i]);
  const total = session.pre.length + session.post.length;
  const n = session.phase === 'pre' ? session.i + 1 : session.pre.length + session.i + 1;
  $('#rate-step').textContent = `Headline ${n} of ${total}`;
  $('#h-date').textContent = fmtDate(h.date);
  $('#h-text').textContent = h.headline;
  pick = null;
  $('#h-next').disabled = true;
  $('#h-scale').replaceChildren(...SCALE.map((s) => radio('scale', s.v, s.label)));
  $('#h-tags').replaceChildren(...TAGS.map((t) => checkbox('tag', t)));
  $('#h-scale').onchange = (e) => { pick = Number(e.target.value); $('#h-next').disabled = false; };
  $('#h-next').onclick = async () => {
    const tags = [...document.querySelectorAll('#h-tags input:checked')].map((x) => x.value);
    await safeAdd({ type: 'rating', pid: session.pid, headline: h.id, phase: session.phase, score: pick, tags });
    session.i++;
    nextHeadline();
  };
  show('rate');
}

// ---------- pairwise comparison ----------
let current;
function nextPair() {
  if (session.compares >= COMPARISONS) {
    if (session.phase === 'extra') return show('results');
    session.phase = 'post'; session.i = 0;
    return nextHeadline();
  }
  current = session.pool.nextPair({ recent: session.recent });
  $('#c-step').textContent = `Comparison ${session.compares + 1} of ${COMPARISONS}`;
  $('#c-left').replaceChildren(card(byId.get(current[0])));
  $('#c-right').replaceChildren(card(byId.get(current[1])));
  show('compare');
}
document.querySelectorAll('[data-pick]').forEach((b) =>
  b.addEventListener('click', async () => {
    const outcome = Number(b.dataset.pick);
    const [a, bId] = current;
    session.pool.record(a, bId, outcome);
    session.recent.push(pairKey(a, bId));
    await safeAdd({ type: 'vote', pid: session.pid, a, b: bId, outcome });
    session.compares++;
    nextPair();
  }));

function card(x) {
  const node = $('#card-tpl').content.cloneNode(true);
  const badge = node.querySelector('.badge');
  badge.textContent = x.status; badge.classList.add(x.status);
  node.querySelector('time').textContent = x.dateText || fmtDate(x.date);
  node.querySelector('.place').textContent = x.place ? ` · ${x.place}` : '';
  node.querySelector('.title').textContent = x.title;
  node.querySelector('.summary').textContent = x.summary;

  const notes = node.querySelector('.notes');
  if (x.notes?.length || x.caveat) {
    notes.querySelector('ul').append(...(x.notes || []).map((n) => el('li', n)));
    if (x.caveat) notes.append(el('p', `What's disputed: ${x.caveat}`));
  } else notes.remove();

  const off = node.querySelector('.official');
  if (x.officialResponse) {
    const d = off.querySelector('div');
    const r = x.officialResponse;
    d.append(el('p', r.verbatim ? r.text : `Paraphrase: ${r.text}`));
    if (r.source) d.append(link(r.source));
  } else {
    off.querySelector('div').append(el('p', 'No official statement found. Know of one? Open an issue with a source.'));
  }

  const rx = node.querySelector('.reactions');
  if (x.reactions?.length) {
    rx.querySelector('ul').append(...x.reactions.map((r) => {
      const li = el('li');
      li.append(meter(condemnLevel(r.text).level), el('strong', r.actor + ': '), el('span', `“${r.text}” `), link({ label: 'source', url: r.url }));
      return li;
    }));
  } else rx.remove();

  node.querySelector('.sources ul').append(...x.sources.map((s) => { const li = el('li'); li.append(link(s)); return li; }));
  return node;
}

function meter(level) {
  const m = el('span'); m.className = 'meter'; m.title = `Condemn-o-meter: ${level}/${MAX_LEVEL}`;
  for (let i = 1; i <= MAX_LEVEL; i++) { const b = el('i'); if (i <= level) b.className = 'on'; m.append(b); }
  return m;
}

// ---------- results ----------
// Community submissions arrive as events and join the pool as 'submitted' (unverified).
function mergeSubmissions(events) {
  events.filter((e) => e.type === 'submit' && e.item && !byId.has(e.item.id))
    .forEach((e) => byId.set(e.item.id, { ...e.item, status: 'submitted', submittedAt: e.t }));
}

async function livePool() {
  const events = await safeAll();
  mergeSubmissions(events);
  const votes = events.filter((e) => e.type === 'vote' && byId.has(e.a) && byId.has(e.b));
  return votes.length ? replay([...byId.keys()], votes, { shuffles: 20 }) : new EloPool([...byId.keys()]);
}

async function renderResults() {
  const events = await safeAll();
  const votes = events.filter((e) => e.type === 'vote');
  const pool = await livePool();
  const ranked = pool.ranking();

  // A fresh submission that climbs into the top 5 steals the headline.
  const breaking = ranked.slice(0, 5).find((it) => isNew(byId.get(it.id)));
  $('#breaking').hidden = !breaking;
  if (breaking) {
    const rank = ranked.indexOf(breaking) + 1;
    const tag = el('span', 'NEW ENTRY'); tag.className = 'badge new';
    $('#breaking').replaceChildren(tag, el('strong', ` Straight in at #${rank}: ${byId.get(breaking.id).title}`),
      el('small', ` Submitted by a visitor, not yet verified. ${breaking.games} votes so far.`));
  }

  const voters = new Set(events.map((e) => e.pid)).size;
  $('#r-meta').textContent = `${votes.length} votes from ${voters} participant${voters === 1 ? '' : 's'}` +
    (API_BASE ? '.' : ' (this browser only — see README to pool votes).');
  $('#r-top').replaceChildren(...pool.top(25).map((it) => {
    const x = byId.get(it.id);
    const li = el('li');
    const s = el('span', `${Math.round(it.rating)} · ${it.games} games`); s.className = 'score';
    const b = el('span', x.status); b.className = `badge ${x.status}`;
    li.append(s, el('strong', x.title + ' '), b);
    if (isNew(x)) { const n = el('span', 'new'); n.className = 'badge new'; li.append(' ', n); }
    return li;
  }));

  const ratings = events.filter((e) => e.type === 'rating');
  $('#r-shift').replaceChildren(...headlines.map((h) => {
    const pre = ratings.filter((r) => r.headline === h.id && r.phase === 'pre').map((r) => r.score);
    const post = ratings.filter((r) => r.headline === h.id && r.phase === 'post').map((r) => r.score);
    const tr = el('tr');
    const td = el('td'); td.append(link({ label: h.headline, url: h.url }));
    if (h.versionNote) { td.append(el('br')); td.append(el('small', h.versionNote)); }
    if (h.criticSource) { td.append(el('br')); const c = el('small'); c.append('Criticised: ', link(h.criticSource)); td.append(c); }
    tr.append(td, num(stat(pre)), num(stat(post)), num(pre.length && post.length ? signed(mean(post) - mean(pre)) : '—'));
    return tr;
  }));
}

if (!SOURCES_CHECKED) {
  const b = el('p', 'Draft: quotes and headline wordings have not yet been checked against their source pages. Do not cite yet.');
  b.className = 'warn draft';
  document.querySelector('main').prepend(b);
}

// ---------- BBC context on Method page ----------
if (bbcContext?.length) {
  const box = $('#bbc-context');
  box.append(el('h3', 'Why the BBC'));
  const ul = el('ul');
  bbcContext.forEach((c) => {
    const li = el('li');
    const b = el('span', c.status); b.className = `badge ${c.status === 'verified' ? 'documented' : c.status === 'reported' ? 'reported' : 'alleged'}`;
    li.append(b, ' ', el('span', c.claim + ' '));
    if (c.source) li.append(link(c.source));
    if (c.note) li.append(el('div', c.note));
    ul.append(li);
  });
  box.append(ul);
}

// ---------- submit a new incident ----------
$('#s-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const urls = [f.get('url1'), f.get('url2')].filter(Boolean);
  const item = {
    id: 'sub-' + crypto.randomUUID().slice(0, 8),
    title: String(f.get('title')).trim().slice(0, 100),
    date: f.get('date'),
    place: String(f.get('place')).trim().slice(0, 80),
    summary: String(f.get('summary')).trim().slice(0, 600),
    sources: urls.map((u) => ({ label: hostOf(u), url: u })),
  };
  await safeAdd({ type: 'submit', pid: session?.pid || crypto.randomUUID(), item });
  byId.set(item.id, { ...item, status: 'submitted', submittedAt: Date.now() });
  ev.target.reset();
  $('#s-done').hidden = false;
});

// ---------- helpers ----------
function isNew(x) { return x?.status === 'submitted' && Date.now() - (x.submittedAt || 0) < NEW_FOR_MS; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } }
async function safeAdd(e) { try { await store.add(e); } catch (err) { console.warn(err); } }
async function safeAll() { try { return await store.all(); } catch (err) { console.warn(err); return []; } }
function el(tag, text) { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; }
function link({ label, url }) { const a = el('a', label); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function radio(name, value, label) { const l = el('label'); const i = el('input'); i.type = 'radio'; i.name = name; i.value = value; l.append(i, label); return l; }
function checkbox(name, value) { const l = el('label'); const i = el('input'); i.type = 'checkbox'; i.name = name; i.value = value; l.append(i, value); return l; }
function num(v) { const td = el('td', v); td.className = 'num'; return td; }
function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
function stat(a) { return a.length ? `${signed(mean(a))} (n=${a.length})` : '—'; }
function signed(x) { return (x > 0 ? '+' : '') + x.toFixed(2); }
function fmtDate(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
