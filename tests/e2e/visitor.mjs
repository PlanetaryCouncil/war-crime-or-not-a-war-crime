// Simulated visitor: clicks through the site like a person and records a short video.
//
//   npm run e2e                 one run, video → recordings/latest.webm
//   npm run e2e -- --runs=10    10 randomised runs (only the last is recorded)
//
// Fails (exit 1) on any page error or a broken flow. Chromium path: $CHROMIUM,
// else the pre-installed one under /opt/pw-browsers, else Playwright's default.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'recordings');
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] || 1);
const SIZE = { width: 1100, height: 700 };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
  res.end(body);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/?n=5`;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wait = (page, ms) => page.waitForTimeout(ms);

// A visible cursor (headless video has none) that glides to each target.
const CURSOR = `
  const c = document.createElement('div');
  c.id = '__cursor';
  c.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;border-radius:50%;background:rgba(179,38,30,.55);border:2px solid #fff;pointer-events:none;left:0;top:0;transform:translate(-50%,-50%);transition:width .1s,height .1s';
  document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  document.addEventListener('mousedown', () => { c.style.width = c.style.height = '12px'; }, true);
  document.addEventListener('mouseup', () => { c.style.width = c.style.height = '18px'; }, true);
  addEventListener('DOMContentLoaded', () => document.body.append(c));
`;

async function click(page, locator, pause = 120) {
  const el = page.locator(locator).first();
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`not visible: ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await wait(page, pause);
  await page.mouse.down(); await page.mouse.up();
}

async function visit(page) {
  await page.goto(BASE);
  await wait(page, 600);
  await click(page, '#begin');

  // Rate headlines before comparing.
  const rateAll = async () => {
    while (await page.locator('#rate').isVisible()) {
      await wait(page, 250);
      await click(page, `#h-scale label >> nth=${pick([0, 1, 1, 2, 2, 3])}`, 80);
      if (Math.random() < 0.3) await click(page, `#h-tags label >> nth=${Math.floor(Math.random() * 7)}`, 60);
      await click(page, '#h-next', 60);
    }
  };
  await rateAll();

  // Compare: peek at the official response once, then choose.
  let peeked = false;
  const compare = async (favour) => {
    while (await page.locator('#compare').isVisible()) {
      await wait(page, 350);
      if (!peeked) { await click(page, '#c-left details.official summary'); await wait(page, 900); peeked = true; }
      const left = await page.locator('#c-left .title').textContent();
      const right = await page.locator('#c-right .title').textContent();
      const choice = favour && left === favour ? '1' : favour && right === favour ? '0' : pick(['1', '1', '0', '0', '0.5']);
      await click(page, `[data-pick="${choice}"]`, 100);
    }
  };
  await compare();
  await rateAll();

  // Results.
  await page.locator('#results').waitFor({ state: 'visible' });
  const votes = await page.locator('#r-meta').textContent();
  if (!/^\d+ votes/.test(votes)) throw new Error(`results missing vote count: ${votes}`);
  await wait(page, 1200);

  // Submit a new incident, then vote until it shows up.
  const title = `Test submission ${Math.floor(Math.random() * 1000)}`;
  await click(page, 'nav [data-go="submit"]');
  await wait(page, 300);
  await page.locator('#s-form [name=title]').pressSequentially(title, { delay: 12 });
  await page.locator('#s-form [name=date]').fill('2026-09-01');
  await page.locator('#s-form [name=place]').pressSequentially('Gaza City', { delay: 12 });
  await page.locator('#s-form [name=summary]').fill('Simulated visitor entry. Not a real incident.');
  await page.locator('#s-form [name=url1]').fill('https://example.org/report');
  await click(page, '#s-form button[type=submit]');
  await page.locator('#s-done').waitFor({ state: 'visible' });
  await wait(page, 500);

  await click(page, 'nav [data-go="results"]');
  await wait(page, 300);
  // Keep voting (backing the new entry) until it takes the headline, max 3 rounds.
  for (let round = 0; round < 3 && !(await page.locator('#breaking').isVisible()); round++) {
    await click(page, '#again');
    await compare(title);
    await page.locator('#results').waitFor({ state: 'visible' });
    await wait(page, 300);
  }
  const seen = await page.locator('#r-top li', { hasText: title }).count();
  if (!seen) throw new Error('submitted incident missing from ranking');
  await wait(page, 1800);
  return { breaking: await page.locator('#breaking').isVisible() };
}

async function run(record) {
  const exe = process.env.CHROMIUM || findChromium();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const context = await browser.newContext({ viewport: SIZE, ...(record ? { recordVideo: { dir: OUT, size: SIZE } } : {}) });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404') && errors.push(m.text()));
  let result, failure;
  try { result = await visit(page); } catch (e) { failure = e; }
  const video = page.video();
  await context.close(); await browser.close();
  if (record && video) await rename(await video.path(), join(OUT, 'latest.webm'));
  if (record && video) await toMp4(join(OUT, 'latest.webm'), join(OUT, 'latest.mp4'));
  if (failure) throw failure;
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  return result;
}

// Squeeze the recording to ~TARGET_SECONDS and make it an mp4 that plays on phones.
const TARGET_SECONDS = 12;
async function toMp4(src, dest) {
  const ffmpeg = process.env.FFMPEG || (await import('ffmpeg-static').then((m) => m.default).catch(() => null));
  if (!ffmpeg) return console.log('no ffmpeg: leaving recordings/latest.webm only');
  const probe = spawnSync(ffmpeg, ['-i', src], { encoding: 'utf8' }).stderr;
  const [, h, m, s] = probe.match(/Duration: (\d+):(\d+):([\d.]+)/) || [];
  const seconds = h ? +h * 3600 + +m * 60 + +s : TARGET_SECONDS;
  const speed = Math.max(1, seconds / TARGET_SECONDS);
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-vf', `setpts=PTS/${speed.toFixed(3)},fps=30`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', dest]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  console.log(`video: ${seconds.toFixed(0)}s of clicking → ${Math.min(seconds, TARGET_SECONDS).toFixed(0)}s mp4 (${speed.toFixed(1)}x)`);
}

function findChromium() {
  const dir = '/opt/pw-browsers';
  if (!existsSync(dir)) return undefined;
  const c = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  const exe = c && join(dir, c, 'chrome-linux', 'chrome');
  return exe && existsSync(exe) ? exe : undefined;
}

await mkdir(OUT, { recursive: true });
let failed = 0;
for (let i = 1; i <= RUNS; i++) {
  try {
    const r = await run(i === RUNS);
    console.log(`run ${i}/${RUNS}: ok${r.breaking ? ' (new entry took the headline)' : ''}`);
  } catch (e) {
    failed++; console.log(`run ${i}/${RUNS}: FAILED — ${e.message}`);
  }
}
server.close();
console.log(failed ? `${failed} of ${RUNS} runs failed` : `all ${RUNS} runs passed · video: recordings/latest.mp4`);
process.exit(failed ? 1 : 0);
