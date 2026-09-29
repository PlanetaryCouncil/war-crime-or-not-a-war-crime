import { EloPool, replay, pairKey } from './lib/elo.js';
import { condemnLevel, MAX_LEVEL } from './lib/condemn.js';
import { makeStore } from './lib/store.js';
import { API_BASE, COMPARISONS_PER_SESSION } from './config.js';
import { incidents, headlines, bbcContext } from './data/dataset.js';

const store = makeStore(API_BASE);
const byId = new Map(incidents.map((x) => [x.id, x]));
const $ = (s) => document.querySelector(s);

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
$('#again').addEventListener('click', () => $('#begin').click());

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
  if (session.compares >= COMPARISONS_PER_SESSION) {
    session.phase = 'post'; session.i = 0;
    return nextHeadline();
  }
  current = session.pool.nextPair({ recent: session.recent });
  $('#c-step').textContent = `Comparison ${session.compares + 1} of ${COMPARISONS_PER_SESSION}`;
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
  node.querySelector('time').textContent = fmtDate(x.date);
  node.querySelector('.place').textContent = x.place;
  node.querySelector('.title').textContent = x.title;
  node.querySelector('.summary').textContent = x.summary;

  const off = node.querySelector('.official');
  if (x.officialResponse) {
    const d = off.querySelector('div');
    const p = el('p');
    const r = x.officialResponse;
    p.textContent = r.verbatim ? `“${r.text}”` : r.text;
    if (r.verbatim) p.className = 'verbatim';
    d.append(p);
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
async function livePool() {
  const events = await safeAll();
  const votes = events.filter((e) => e.type === 'vote' && byId.has(e.a) && byId.has(e.b));
  return votes.length ? replay([...byId.keys()], votes, { shuffles: 20 }) : new EloPool([...byId.keys()]);
}

async function renderResults() {
  const events = await safeAll();
  const votes = events.filter((e) => e.type === 'vote');
  const pool = await livePool();
  const voters = new Set(events.map((e) => e.pid)).size;
  $('#r-meta').textContent = `${votes.length} votes from ${voters} participant${voters === 1 ? '' : 's'}` +
    (API_BASE ? '.' : ' (this browser only — see README to pool votes).');
  $('#r-top').replaceChildren(...pool.top(25).map((it) => {
    const x = byId.get(it.id);
    const li = el('li');
    const s = el('span', `${Math.round(it.rating)} · ${it.games} games`); s.className = 'score';
    const b = el('span', x.status); b.className = `badge ${x.status}`;
    li.append(s, el('strong', x.title + ' '), b);
    return li;
  }));

  const ratings = events.filter((e) => e.type === 'rating');
  $('#r-shift').replaceChildren(...headlines.map((h) => {
    const pre = ratings.filter((r) => r.headline === h.id && r.phase === 'pre').map((r) => r.score);
    const post = ratings.filter((r) => r.headline === h.id && r.phase === 'post').map((r) => r.score);
    const tr = el('tr');
    const td = el('td'); td.append(link({ label: h.headline, url: h.url }));
    if (h.criticSource) { td.append(el('br')); const c = el('small'); c.append('Criticised: ', link(h.criticSource)); td.append(c); }
    tr.append(td, num(stat(pre)), num(stat(post)), num(pre.length && post.length ? signed(mean(post) - mean(pre)) : '—'));
    return tr;
  }));
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

// ---------- helpers ----------
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
