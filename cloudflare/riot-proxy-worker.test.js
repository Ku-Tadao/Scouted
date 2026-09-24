// Run: node cloudflare/riot-proxy-worker.test.js
import assert from 'node:assert/strict';
import worker, { RateLimiter } from './riot-proxy-worker.js';

const calls = [];
let rateLimitAfter = Infinity;
const match429s = new Map(); // matchId -> how many 429s to return before succeeding
let totalMatches = 2; // length of the fake player's match history
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
  if (url.includes('/ids?')) {
    const q = new URL(url).searchParams;
    const start = Number(q.get('start') || 0);
    const count = Math.max(0, Math.min(Number(q.get('count')), totalMatches - start));
    return ok(Array.from({ length: count }, (_, i) => `OC1_${start + i + 1}`));
  }
  if (url.includes('/tft/match/v1/matches/')) {
    const id = url.split('/').pop();
    if (match429s.get(id) > 0) {
      match429s.set(id, match429s.get(id) - 1);
      return new Response('', { status: 429, headers: { 'Retry-After': '1' } });
    }
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

// Stale names: missing ones first, then legacy string entries (no timestamp) and week-old names; fresh ones are skipped.
rateLimitAfter = Infinity;
const seeded = JSON.parse(store.get('names:na1'));
seeded.p49 = 'Old#NAME'; // format written before names had timestamps
seeded.p48 = { name: 'Renamed#OLD', at: Date.now() - 8 * 24 * 60 * 60 * 1000 };
store.set('names:na1', JSON.stringify(seeded));
calls.length = 0;
await worker.scheduled({ scheduledTime: slot(90) }, env); // na1 challenger, two cycles later
const lookedUp = calls.filter((u) => u.includes('/accounts/by-puuid/')).map((u) => u.split('/').pop());
assert.deepEqual(lookedUp, ['p1', 'p0', 'p49', 'p48']);
snap = JSON.parse(store.get('lb:na1:challenger'));
assert.equal(snap.unresolvedNames, 0);
assert.equal(snap.entries[0].summonerName, 'p49#TAG');
assert.equal(snap.entries[1].summonerName, 'p48#TAG');
const saved = JSON.parse(store.get('names:na1'));
assert.ok(Object.values(saved).every((v) => typeof v.name === 'string' && v.at > 0), 'every name stored with a timestamp');

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

// A 429 on a match fetch is retried once; a second 429 drops that match and reports it as missing.
match429s.set('OC1_1', 1).set('OC1_2', 2);
const retried = await (await worker.fetch(new Request('https://w/player?puuid=me'), env)).json();
assert.deepEqual(retried.matches.map((m) => m.id), ['OC1_1']);
assert.equal(retried.missingMatches, 1);
assert.equal(body.missingMatches, 0);
assert.equal(body.puuid, 'me');
assert.equal(body.nextStart, null, 'fewer than 10 matches: nothing more to load');

// Load more: the first page ends at 10, /matches returns the rest from the match cluster only.
totalMatches = 15;
const firstPage = await (await worker.fetch(new Request('https://w/player?puuid=me'), env)).json();
assert.equal(firstPage.matches.length, 10);
assert.equal(firstPage.nextStart, 10);
calls.length = 0;
const more = await worker.fetch(new Request('https://w/matches?puuid=me&region=oc1&start=10'), env);
const morePage = await more.json();
assert.equal(more.status, 200);
assert.deepEqual(morePage.matches.map((m) => m.id), ['OC1_11', 'OC1_12', 'OC1_13', 'OC1_14', 'OC1_15']);
assert.equal(morePage.nextStart, null);
assert.ok(calls.every((u) => u.startsWith('https://sea.api.riotgames.com/tft/match/v1/')), 'no account or rank calls');
for (const bad of ['puuid=me&region=xx1&start=10', 'puuid=../x&region=oc1&start=10', 'puuid=me&region=oc1&start=0', 'puuid=me&region=oc1&start=abc']) {
  assert.equal((await worker.fetch(new Request('https://w/matches?' + bad), env)).status, 400, bad);
}
totalMatches = 2;

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
const moreBlocked = await worker.fetch(new Request('https://w/matches?puuid=me&region=oc1&start=10', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }), limited);
assert.equal(moreBlocked.status, 429, 'load more counts against the same per-IP limit');
assert.equal(calls.length, 0);
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
