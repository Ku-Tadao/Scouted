const REGIONS = ['na1', 'euw1', 'eun1', 'kr', 'jp1', 'oc1'];
const TIERS = ['challenger', 'grandmaster', 'master'];
const BOARDS = REGIONS.flatMap((region) => TIERS.map((tier) => ({ region, tier })));
// Free Workers plan allows 50 subrequests per invocation: 1 league fetch + 45 name lookups.
const NAME_LOOKUP_BUDGET = 45;
const NAME_REQUEST_DELAY_MS = 75;
const SNAPSHOT_TTL = 60 * 60 * 24 * 2;
const PLAYER_MATCH_COUNT = 10;
// account-v1 is global: any cluster resolves any player.
const ACCOUNT_HOST = 'https://europe.api.riotgames.com';
const MATCH_ROUTING = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', tw2: 'sea', vn2: 'sea',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/health') {
      return json(
        {
          ok: true,
          service: 'scouted-riot-proxy',
          snapshotMode: Boolean(env.SCOUTED_KV),
        },
        200,
        request,
      );
    }

    if (!env.RIOT_API_KEY) {
      return json({ error: 'Server not configured' }, 500, request);
    }

    if (url.pathname === '/leaderboard') return leaderboard(url, env, request);
    if (url.pathname === '/player') return player(url, env, request);
    return json({ error: 'Not found' }, 404, request);
  },

  // One board per 5-minute slot: all 18 boards refresh every 90 minutes, and each run
  // costs ~2 KV writes (≈580/day, under the free 1,000/day). Works with a */5 or every-minute cron.
  async scheduled(event, env) {
    if (!env.RIOT_API_KEY || !env.SCOUTED_KV) return;
    if (Math.floor(event.scheduledTime / 60_000) % 5 !== 0) return;
    const { region, tier } = BOARDS[Math.floor(event.scheduledTime / 300_000) % BOARDS.length];
    await refreshBoard(env, region, tier);
  },
};

async function leaderboard(url, env, request) {
  const region = (url.searchParams.get('region') || 'na1').toLowerCase();
  const tier = (url.searchParams.get('tier') || 'challenger').toLowerCase();

  if (!REGIONS.includes(region)) {
    return json({ error: 'Invalid region' }, 400, request);
  }

  if (!TIERS.includes(tier)) {
    return json({ error: 'Invalid tier' }, 400, request);
  }

  if (env.SCOUTED_KV) {
    const snapshot = await env.SCOUTED_KV.get(snapshotKey(region, tier), 'json').catch(() => null);
    if (snapshot) return json(snapshot, 200, request);
  }

  const board = await fetchBoard(env.RIOT_API_KEY, region, tier);
  if (!board.ok) return riotError(board, request, 'Leaderboard not found');

  if (env.SCOUTED_KV) applyNames(board.entries, await getNames(env.SCOUTED_KV, region));

  return json(
    {
      region,
      tier,
      queue: board.queue,
      fetchedAt: new Date().toISOString(),
      entries: board.entries,
    },
    200,
    request,
  );
}

async function refreshBoard(env, region, tier) {
  const apiKey = env.RIOT_API_KEY;
  const board = await fetchBoard(apiKey, region, tier);
  if (!board.ok) return;

  // ponytail: names are never pruned or refreshed, so renamed players keep their old Riot ID;
  // store { name, at } and re-resolve old entries if that matters.
  const names = await getNames(env.SCOUTED_KV, region);
  const missing = board.entries.filter((entry) => entry.puuid && !names[entry.puuid]);
  let resolved = 0;

  for (const entry of missing.slice(0, NAME_LOOKUP_BUDGET)) {
    const account = await riotJson(`${ACCOUNT_HOST}/riot/account/v1/accounts/by-puuid/${encodeURIComponent(entry.puuid)}`, apiKey);
    if (account.status === 429) break; // next pass picks up where this one stopped
    if (account.ok && account.data?.gameName) {
      names[entry.puuid] = `${account.data.gameName}#${account.data.tagLine}`;
      resolved += 1;
    }
    await sleep(NAME_REQUEST_DELAY_MS);
  }

  if (resolved > 0) {
    await env.SCOUTED_KV.put(namesKey(region), JSON.stringify(names));
  }

  applyNames(board.entries, names);
  await env.SCOUTED_KV.put(
    snapshotKey(region, tier),
    JSON.stringify({
      region,
      tier,
      queue: board.queue,
      fetchedAt: new Date().toISOString(),
      unresolvedNames: missing.length - resolved,
      entries: board.entries,
    }),
    { expirationTtl: SNAPSHOT_TTL },
  );
}

// ponytail: no per-visitor rate limit; each search costs ~14 Riot calls from the shared key.
// Add a Workers rate-limit binding if searches start eating the key's budget.
async function player(url, env, request) {
  const apiKey = env.RIOT_API_KEY;
  const riotId = (url.searchParams.get('riotId') || '').trim();
  const hash = riotId.lastIndexOf('#');
  const gameName = riotId.slice(0, hash).trim();
  const tagLine = riotId.slice(hash + 1).trim();

  if (hash < 1 || !gameName || !tagLine || gameName.length > 16 || tagLine.length > 5) {
    return json({ error: 'Enter a Riot ID like Name#TAG' }, 400, request);
  }

  const account = await riotJson(
    `${ACCOUNT_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    apiKey,
    3600,
  );
  if (!account.ok) return riotError(account, request, 'Player not found');
  const puuid = account.data.puuid;

  const home = await riotJson(`${ACCOUNT_HOST}/riot/account/v1/region/by-game/tft/by-puuid/${encodeURIComponent(puuid)}`, apiKey, 3600);
  if (!home.ok) return riotError(home, request, 'This player has not played TFT');

  const region = String(home.data.region || '').toLowerCase();
  const matchRouting = MATCH_ROUTING[region];
  if (!matchRouting) return json({ error: `Unsupported region: ${region}` }, 502, request);

  const [ranks, matchIds] = await Promise.all([
    riotJson(`https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`, apiKey, 60),
    riotJson(
      `https://${matchRouting}.api.riotgames.com/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?count=${PLAYER_MATCH_COUNT}`,
      apiKey,
      60,
    ),
  ]);
  if (!ranks.ok) return riotError(ranks, request, 'Rank not found');
  if (!matchIds.ok) return riotError(matchIds, request, 'Match history not found');

  // Matches never change, so they cache for a day.
  const matches = await Promise.all(
    matchIds.data.map((id) =>
      riotJson(`https://${matchRouting}.api.riotgames.com/tft/match/v1/matches/${encodeURIComponent(id)}`, apiKey, 86400),
    ),
  );

  return json(
    {
      riotId: `${account.data.gameName}#${account.data.tagLine}`,
      region,
      ranks: ranks.data.map((r) => ({
        queue: r.queueType,
        tier: r.tier || r.ratedTier || null,
        rank: r.rank || null,
        leaguePoints: r.leaguePoints ?? r.ratedRating ?? null,
        wins: r.wins,
        losses: r.losses,
      })),
      matches: matches.filter((m) => m.ok).map((m) => summarizeMatch(m.data, puuid)).filter(Boolean),
    },
    200,
    request,
  );
}

function summarizeMatch(match, puuid) {
  const info = match?.info;
  const me = info?.participants?.find((p) => p.puuid === puuid);
  if (!me) return null;
  return {
    id: match.metadata?.match_id || '',
    playedAt: info.game_datetime,
    queueId: info.queue_id,
    placement: me.placement,
    level: me.level,
    augments: me.augments || [],
    units: (me.units || []).map((u) => ({ id: u.character_id, stars: u.tier, items: u.itemNames || [] })),
  };
}

function json(payload, status, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
    },
  });
}

function riotError(res, request, notFoundMessage) {
  if (res.status === 404) return json({ error: notFoundMessage }, 404, request);
  if (res.status === 429) {
    return json({ error: 'Riot rate limit reached, try again in a minute', retryAfter: res.retryAfter }, 429, request);
  }
  return json({ error: 'Riot API request failed', status: res.status, details: res.details }, 502, request);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = isAllowedOrigin(origin) ? origin : 'https://ku-tadao.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function isAllowedOrigin(origin) {
  return (
    origin === 'https://ku-tadao.github.io' ||
    origin === 'http://localhost:4321' ||
    origin === 'http://127.0.0.1:4321'
  );
}

// Single attempt, no retry: a 429 goes straight back to the caller (or ends the cron pass).
async function riotJson(url, apiKey, cacheTtl = 0) {
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': apiKey },
    ...(cacheTtl ? { cf: { cacheTtl, cacheEverything: true } } : {}),
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      retryAfter: Number(res.headers.get('Retry-After')) || null,
      details: (await res.text()).slice(0, 400),
    };
  }
  return { ok: true, status: res.status, data: await res.json() };
}

async function fetchBoard(apiKey, region, tier) {
  const res = await riotJson(`https://${region}.api.riotgames.com/tft/league/v1/${tier}`, apiKey, 45);
  if (!res.ok) return res;

  const entries = Array.isArray(res.data.entries)
    ? [...res.data.entries]
        .sort((a, b) => Number(b.leaguePoints || 0) - Number(a.leaguePoints || 0))
        .map((entry, index) => ({
          rank: index + 1,
          puuid: entry.puuid || '',
          summonerName: 'Unknown',
          leaguePoints: Number(entry.leaguePoints || 0),
          wins: Number(entry.wins || 0),
          losses: Number(entry.losses || 0),
        }))
    : [];

  return { ok: true, queue: res.data.queue || null, entries };
}

function applyNames(entries, names) {
  for (const entry of entries) {
    if (names[entry.puuid]) entry.summonerName = names[entry.puuid];
  }
}

async function getNames(kv, region) {
  return (await kv.get(namesKey(region), 'json').catch(() => null)) || {};
}

function namesKey(region) {
  return `names:${region}`;
}

function snapshotKey(region, tier) {
  return `lb:${region}:${tier}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
