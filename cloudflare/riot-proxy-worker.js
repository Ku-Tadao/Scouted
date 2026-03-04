const REGIONS = ['na1', 'euw1', 'eun1', 'kr', 'jp1', 'oc1'];
const TIERS = ['challenger', 'grandmaster', 'master'];
const NAME_LOOKUP_BUDGET = 60;
const NAME_REQUEST_DELAY_MS = 75;
const REFRESH_STATE_KEY = 'meta:refresh_state';
const REFRESH_STATE_TTL = 60 * 60 * 24 * 2;

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

    if (url.pathname !== '/leaderboard') {
      return json({ error: 'Not found' }, 404, request);
    }

    const region = (url.searchParams.get('region') || 'na1').toLowerCase();
    const tier = (url.searchParams.get('tier') || 'challenger').toLowerCase();

    if (!REGIONS.includes(region)) {
      return json({ error: 'Invalid region' }, 400, request);
    }

    if (!TIERS.includes(tier)) {
      return json({ error: 'Invalid tier' }, 400, request);
    }

    if (env.SCOUTED_KV) {
      const snapshot = await getSnapshot(env.SCOUTED_KV, region, tier);
      if (snapshot) return json(snapshot, 200, request);
    }

    const apiKey = env.RIOT_API_KEY;
    if (!apiKey) {
      return json({ error: 'Server not configured' }, 500, request);
    }

    const fallback = await fetchLeaderboardBase(apiKey, region, tier);
    if (!fallback.ok) {
      return json(
        {
          error: 'Riot API request failed',
          status: fallback.status,
          details: fallback.details,
        },
        fallback.status,
        request,
      );
    }

    return json(
      {
        region,
        tier,
        queue: fallback.data.queue || null,
        fetchedAt: new Date().toISOString(),
        entries: fallback.data.entries,
      },
      200,
      request,
    );
  },

  async scheduled(_event, env) {
    if (!env.RIOT_API_KEY || !env.SCOUTED_KV) return;

    const now = amsterdamNow();
    let state = await getRefreshState(env.SCOUTED_KV);

    if (!state || state.dateKey !== now.dateKey) {
      if (now.hour !== 2) return;
      state = {
        dateKey: now.dateKey,
        inProgress: true,
        cursor: 0,
        runCount: 0,
        lastUnresolved: null,
        stagnantRuns: 0,
      };
    }

    if (!state.inProgress) return;

    const snapshotMap = new Map();
    const candidates = [];

    for (const region of REGIONS) {
      for (const tier of TIERS) {
        const result = await fetchLeaderboardBase(env.RIOT_API_KEY, region, tier);
        if (!result.ok) continue;

        const entries = result.data.entries;
        for (const entry of entries) {
          const cacheKey = playerCacheKey(entry);
          if (!cacheKey) continue;

          const knownName = await env.SCOUTED_KV.get(cacheKey);
          if (knownName) {
            entry.summonerName = knownName;
            continue;
          }

          candidates.push({ region, tier, entry });
        }

        snapshotMap.set(snapshotKey(region, tier), {
          region,
          tier,
          queue: result.data.queue || null,
          fetchedAt: new Date().toISOString(),
          entries,
        });
      }
    }

    if (candidates.length === 0) {
      state.inProgress = false;
      state.completedAt = new Date().toISOString();
      await persistSnapshots(env.SCOUTED_KV, snapshotMap);
      await env.SCOUTED_KV.put(REFRESH_STATE_KEY, JSON.stringify(state), { expirationTtl: REFRESH_STATE_TTL });
      await env.SCOUTED_KV.put(
        'meta:last_refresh',
        JSON.stringify({
          at: new Date().toISOString(),
          snapshots: snapshotMap.size,
          unresolvedCandidates: 0,
          lookedUpToday: 0,
          runCount: state.runCount,
          mode: 'complete',
        }),
        { expirationTtl: 60 * 60 * 24 * 7 },
      );
      return;
    }

    const cursor = Number(state.cursor || 0) || 0;
    let processed = 0;
    let index = cursor % candidates.length;

    while (processed < NAME_LOOKUP_BUDGET) {
      const target = candidates[index];
      const name = await resolveSummonerName(env.RIOT_API_KEY, target.region, target.entry.summonerId, target.entry.puuid);
      if (name) {
        target.entry.summonerName = name;
        const cacheKey = playerCacheKey(target.entry);
        if (cacheKey) {
          await env.SCOUTED_KV.put(cacheKey, name, { expirationTtl: 60 * 60 * 24 * 14 });
        }
      }

      processed += 1;
      index = (index + 1) % candidates.length;
      await sleep(NAME_REQUEST_DELAY_MS);
    }

    await persistSnapshots(env.SCOUTED_KV, snapshotMap);

    state.cursor = index;
    state.runCount = Number(state.runCount || 0) + 1;
    if (state.lastUnresolved === candidates.length) {
      state.stagnantRuns = Number(state.stagnantRuns || 0) + 1;
    } else {
      state.stagnantRuns = 0;
    }
    state.lastUnresolved = candidates.length;
    state.lastRunAt = new Date().toISOString();

    await env.SCOUTED_KV.put(REFRESH_STATE_KEY, JSON.stringify(state), { expirationTtl: REFRESH_STATE_TTL });

    await env.SCOUTED_KV.put(
      'meta:last_refresh',
      JSON.stringify({
        at: new Date().toISOString(),
        snapshots: snapshotMap.size,
        unresolvedCandidates: candidates.length,
        lookedUpToday: processed,
        runCount: state.runCount,
        stagnantRuns: state.stagnantRuns,
        mode: 'in-progress',
      }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
  },
};

function json(payload, status, request) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
    },
  });
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

async function resolveSummonerName(apiKey, region, summonerId, puuid) {
  if (!summonerId && !puuid) return null;
  let name = null;

  if (summonerId) {
    const summonerUrl = `https://${region}.api.riotgames.com/tft/summoner/v1/summoners/${encodeURIComponent(summonerId)}`;
    const res = await fetchWithRetry(summonerUrl, apiKey, 2);

    if (res.ok) {
      const payload = await res.json().catch(() => null);
      name = payload?.name || null;
    }
  }

  if (!name && puuid) {
    const regional = regionalRoutingForPlatform(region);
    const accountUrl = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
    const accountRes = await fetchWithRetry(accountUrl, apiKey, 2);

    if (accountRes.ok) {
      const account = await accountRes.json().catch(() => null);
      if (account?.gameName) {
        name = account?.tagLine ? `${account.gameName}#${account.tagLine}` : account.gameName;
      }
    }
  }

  if (!name) return null;
  return name;
}

async function fetchLeaderboardBase(apiKey, region, tier) {
  const riotUrl = `https://${region}.api.riotgames.com/tft/league/v1/${tier}`;
  const upstream = await fetchWithRetry(riotUrl, apiKey, 3, {
    cf: {
      cacheTtl: 45,
      cacheEverything: true,
    },
  });

  if (!upstream.ok) {
    return {
      ok: false,
      status: upstream.status,
      details: (await upstream.text()).slice(0, 400),
    };
  }

  const payload = await upstream.json();
  const entries = Array.isArray(payload.entries)
    ? [...payload.entries]
        .sort((a, b) => Number(b.leaguePoints || 0) - Number(a.leaguePoints || 0))
        .map((entry, index) => ({
          rank: index + 1,
          summonerId: entry.summonerId || entry.summoner_id || '',
          puuid: entry.puuid || '',
          summonerName: entry.summonerName || 'Unknown',
          leaguePoints: Number(entry.leaguePoints || 0),
          wins: Number(entry.wins || 0),
          losses: Number(entry.losses || 0),
        }))
    : [];

  return {
    ok: true,
    data: {
      queue: payload.queue || null,
      entries,
    },
  };
}

function playerCacheKey(entry) {
  if (entry?.puuid) return `name:puuid:${entry.puuid}`;
  if (entry?.summonerId) return `name:sid:${entry.summonerId}`;
  return null;
}

function snapshotKey(region, tier) {
  return `lb:${region}:${tier}`;
}

async function getSnapshot(kv, region, tier) {
  const raw = await kv.get(snapshotKey(region, tier));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, apiKey, maxAttempts, extraInit = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...extraInit,
      headers: {
        ...(extraInit.headers || {}),
        'X-Riot-Token': apiKey,
      },
    });

    if (response.ok) return response;

    if (!shouldRetry(response.status) || attempt === maxAttempts) {
      return response;
    }

    await sleep(60000);
  }

  return new Response('retry failed', { status: 503 });
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

async function persistSnapshots(kv, snapshotMap) {
  for (const [key, snapshot] of snapshotMap.entries()) {
    await kv.put(key, JSON.stringify(snapshot), { expirationTtl: 60 * 60 * 24 * 2 });
  }
}

async function getRefreshState(kv) {
  const raw = await kv.get(REFRESH_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function amsterdamNow() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour || '0'),
  };
}

function regionalRoutingForPlatform(platform) {
  if (platform === 'na1') return 'americas';
  if (platform === 'euw1' || platform === 'eun1') return 'europe';
  if (platform === 'kr' || platform === 'jp1') return 'asia';
  if (platform === 'oc1') return 'sea';
  return 'americas';
}
