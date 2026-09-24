// Run: node cloudflare/riot-proxy-worker.test.js
import assert from 'node:assert/strict';
import worker, { RateLimiter } from './riot-proxy-worker.js';

const calls = [];
let rateLimitAfter = Infinity;
globalThis.fetch = async (url) => {
  calls.push(url);
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
  if (/\/tft\/league\/v1\/(challenger|grandmaster|master)$/.test(url)) {
    return ok({ queue: 'RANKED_TFT', entries: Array.from({ length: 50 }, (_, i) => ({ puuid: `p${i}`, leaguePoints: i, wins: 1, losses: 1 })) });
  }
  if (url.includes('/accounts/by-puuid/')) {
    if (calls.filter((u) => u.includes('/accounts/by-puuid/')).length > rateLimitAfter) return new Response('', { status: 429 });
    return ok({ puuid: url.split('/').pop(), gameName: url.split('/').pop(), tagLine: 'TAG' });
  }
  if (url.includes('/accounts/by-riot-id/')) return ok({ puuid: 'me', gameName: 'Some Player', tagLine: 'OCE' });
  if (url.includes('/region/by-game/tft/')) return ok({ puuid: 'me', game: 'tft', region: 'OC1' });
  if (url.includes('/tft/league/v1/by-puuid/')) return ok([{ queueType: 'RANKED_TFT', tier: 'DIAMOND', rank: 'II', leaguePoints: 40, wins: 10, losses: 20 }]);
  if (url.includes('/ids?')) return ok(['OC1_1', 'OC1_2']);
  if (url.includes('/tft/match/v1/matches/')) {
    return ok({
      metadata: { match_id: url.split('/').pop() },
      info: {
        game_datetime: 1, queue_id: 1100,
        participants: [{ puuid: 'me', placement: 3, level: 8, augments: ['A'], units: [{ character_id: 'TFT16_Ahri', tier: 2, itemNames: ['X'] }] }],
      },
    });
  }
  throw new Error('unexpected fetch ' + url);
};

const store = new Map();
const kv = {
  async get(key, type) { const v = store.get(key); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
  async put(key, value) { store.set(key, value); },
};
const env = { RIOT_API_KEY: 'k', SCOUTED_KV: kv };
const slot = (i) => i * 300_000; // slot 0 = na1 challenger

// Off-slot minute does nothing.
await worker.scheduled({ scheduledTime: slot(0) + 60_000 }, env);
assert.equal(calls.length, 0);

// First pass: board + 45 names, top LP first, account lookups on a valid account-v1 host.
await worker.scheduled({ scheduledTime: slot(0) }, env);
let snap = JSON.parse(store.get('lb:na1:challenger'));
assert.equal(snap.entries.length, 50);
assert.equal(snap.entries[0].summonerName, 'p49#TAG');
assert.equal(snap.unresolvedNames, 5);
assert.equal(Object.keys(JSON.parse(store.get('names:na1'))).length, 45);
assert.ok(calls.filter((u) => u.includes('/accounts/')).every((u) => u.startsWith('https://europe.')));

// Next pass over the same board resolves the rest, stopping cleanly on a 429.
calls.length = 0;
rateLimitAfter = 3;
await worker.scheduled({ scheduledTime: slot(45) }, env); // one full cycle (15 regions x 3 tiers) later
snap = JSON.parse(store.get('lb:na1:challenger'));
assert.equal(snap.unresolvedNames, 2);
assert.equal(calls.filter((u) => u.includes('/accounts/by-puuid/')).length, 4);

// Master boards skip name lookups but still show names already known for the region.
calls.length = 0;
await worker.scheduled({ scheduledTime: slot(2) }, env); // slot 2 = na1 master
snap = JSON.parse(store.get('lb:na1:master'));
assert.equal(calls.filter((u) => u.includes('/accounts/')).length, 0);
assert.equal(snap.unresolvedNames, undefined);
assert.equal(snap.entries[0].summonerName, 'p49#TAG');

// Leaderboard serves the snapshot.
const lb = await worker.fetch(new Request('https://w/leaderboard?region=na1&tier=challenger'), env);
assert.equal((await lb.json()).entries[0].summonerName, 'p49#TAG');

// Player search: OCE player → matches via sea, account via europe.
calls.length = 0;
const res = await worker.fetch(new Request('https://w/player?riotId=' + encodeURIComponent('Some Player#OCE')), env);
const body = await res.json();
assert.equal(res.status, 200, JSON.stringify(body));
assert.equal(body.riotId, 'Some Player#OCE');
assert.equal(body.region, 'oc1');
assert.equal(body.ranks[0].tier, 'DIAMOND');
assert.deepEqual(body.matches[0], { id: 'OC1_1', playedAt: 1, queueId: 1100, placement: 3, level: 8, augments: ['A'], units: [{ id: 'TFT16_Ahri', stars: 2, items: ['X'] }] });
assert.ok(calls.some((u) => u.startsWith('https://sea.api.riotgames.com/tft/match/v1/matches/OC1_1')));
assert.ok(calls.some((u) => u.startsWith('https://oc1.api.riotgames.com/tft/league/v1/by-puuid/me')));

// Player search by puuid (leaderboard row click) skips the Riot ID lookup.
rateLimitAfter = Infinity;
calls.length = 0;
const byPuuid = await worker.fetch(new Request('https://w/player?puuid=me'), env);
assert.equal(byPuuid.status, 200);
assert.ok(calls[0].startsWith('https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/me'));
assert.ok(!calls.some((u) => u.includes('/by-riot-id/')));
assert.equal((await worker.fetch(new Request('https://w/player?puuid=' + encodeURIComponent('../x')), env)).status, 400);

// Rate limits: per visitor IP, then per match cluster once the player's region is known.
// Fake Durable Object namespace running the real RateLimiter class on in-memory storage.
const objects = new Map();
const RATE_LIMITER = {
  idFromName: (name) => name,
  get: (id) => {
    if (!objects.has(id)) {
      const mem = new Map();
      objects.set(id, new RateLimiter({ storage: { get: async (k) => mem.get(k), put: async (k, v) => mem.set(k, v) } }));
    }
    return { fetch: (url) => objects.get(id).fetch(new Request(url)) };
  },
};
const limited = { ...env, RATE_LIMITER };
const search = (ip) => worker.fetch(new Request('https://w/player?puuid=me', { headers: { 'CF-Connecting-IP': ip } }), limited);
for (let i = 0; i < 4; i++) assert.equal((await search('1.1.1.1')).status, 200);
calls.length = 0;
const busy = await search('2.2.2.2'); // 5th search on the sea cluster
assert.equal(busy.status, 429);
assert.match((await busy.json()).error, /busy/);
assert.ok(!calls.some((u) => u.includes('.api.riotgames.com/tft/')), 'no platform or match calls once the cluster is full');
for (let i = 0; i < 2; i++) await search('1.1.1.1'); // 6 total from this IP
calls.length = 0;
const tooMany = await search('1.1.1.1');
assert.equal(tooMany.status, 429);
assert.match((await tooMany.json()).error, /Too many searches/);
assert.equal(calls.length, 0, 'IP limit is checked before any Riot call');
assert.equal(objects.size, 3, 'one limiter object per key: 2 IPs + the sea cluster');

// The window slides: a minute later the same IP can search again.
const realNow = Date.now;
Date.now = () => realNow() + 61_000;
assert.equal((await search('3.3.3.3')).status, 200);
assert.equal((await search('1.1.1.1')).status, 200);
Date.now = realNow;

// Bad Riot ID is rejected before any Riot call.
calls.length = 0;
assert.equal((await worker.fetch(new Request('https://w/player?riotId=nohash'), env)).status, 400);
assert.equal(calls.length, 0);

console.log('worker ok');
