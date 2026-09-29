// store.js — where votes and headline ratings live.
//
// Everything is an append-only event: { type: 'vote' | 'rating', ... }.
// LocalStore keeps them in this browser only (fine for a solo run / demo).
// RemoteStore talks to worker/ (Cloudflare Worker + D1) so everyone's
// votes feed one shared ranking. Pick one in config.js.

const KEY = 'wcnwc.events.v1';

export class LocalStore {
  async add(event) {
    const all = await this.all();
    all.push({ ...event, t: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: keep in memory */ this._mem = all; }
  }
  async all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return this._mem || []; }
  }
}

export class RemoteStore {
  constructor(base) { this.base = base.replace(/\/$/, ''); }
  async add(event) {
    const res = await fetch(`${this.base}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`save failed: ${res.status}`);
  }
  async all() {
    const res = await fetch(`${this.base}/api/events`);
    if (!res.ok) throw new Error(`load failed: ${res.status}`);
    return res.json();
  }
}

export function makeStore(apiBase) {
  return apiBase ? new RemoteStore(apiBase) : new LocalStore();
}
