export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'scouted-riot-proxy' }, 200, request);
    }

    if (url.pathname !== '/leaderboard') {
      return json({ error: 'Not found' }, 404, request);
    }

    const apiKey = env.RIOT_API_KEY;
    if (!apiKey) {
      return json({ error: 'Server not configured' }, 500, request);
    }

    const region = (url.searchParams.get('region') || 'na1').toLowerCase();
    const tier = (url.searchParams.get('tier') || 'challenger').toLowerCase();

    const allowedRegions = new Set(['na1', 'euw1', 'eun1', 'kr', 'jp1', 'oc1']);
    const tierPath = {
      challenger: 'challenger',
      grandmaster: 'grandmaster',
      master: 'master',
    }[tier];

    if (!allowedRegions.has(region)) {
      return json({ error: 'Invalid region' }, 400, request);
    }

    if (!tierPath) {
      return json({ error: 'Invalid tier' }, 400, request);
    }

    const riotUrl = `https://${region}.api.riotgames.com/tft/league/v1/${tierPath}`;

    const upstream = await fetch(riotUrl, {
      headers: {
        'X-Riot-Token': apiKey,
      },
      cf: {
        cacheTtl: 45,
        cacheEverything: true,
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return json(
        {
          error: 'Riot API request failed',
          status: upstream.status,
          details: text.slice(0, 400),
        },
        upstream.status,
        request,
      );
    }

    const data = await upstream.json();

    const entries = Array.isArray(data.entries)
      ? [...data.entries]
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

    await hydrateSummonerNames(entries, request, apiKey, region, ctx);

    return json(
      {
        region,
        tier,
        queue: data.queue || null,
        fetchedAt: new Date().toISOString(),
        entries,
      },
      200,
      request,
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

async function hydrateSummonerNames(entries, request, apiKey, region, ctx) {
  const NAME_LOOKUP_LIMIT = 40;
  const BATCH_SIZE = 10;
  const targets = entries
    .filter((entry) => (!entry.summonerName || entry.summonerName === 'Unknown') && (entry.summonerId || entry.puuid))
    .slice(0, NAME_LOOKUP_LIMIT);

  for (let index = 0; index < targets.length; index += BATCH_SIZE) {
    const batch = targets.slice(index, index + BATCH_SIZE);
    const names = await Promise.all(
      batch.map((entry) => resolveSummonerName(request, apiKey, region, entry.summonerId, entry.puuid, ctx)),
    );

    batch.forEach((entry, idx) => {
      if (names[idx]) entry.summonerName = names[idx];
    });
  }
}

async function resolveSummonerName(request, apiKey, region, summonerId, puuid, ctx) {
  if (!summonerId && !puuid) return null;
  let name = null;

  if (summonerId) {
    const summonerUrl = `https://${region}.api.riotgames.com/tft/summoner/v1/summoners/${encodeURIComponent(summonerId)}`;
    const res = await fetch(summonerUrl, {
      headers: {
        'X-Riot-Token': apiKey,
      },
    });

    if (res.ok) {
      const payload = await res.json().catch(() => null);
      name = payload?.name || null;
    }
  }

  if (!name && puuid) {
    const regional = regionalRoutingForPlatform(region);
    const accountUrl = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
    const accountRes = await fetch(accountUrl, {
      headers: {
        'X-Riot-Token': apiKey,
      },
    });

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

function regionalRoutingForPlatform(platform) {
  if (platform === 'na1') return 'americas';
  if (platform === 'euw1' || platform === 'eun1') return 'europe';
  if (platform === 'kr' || platform === 'jp1') return 'asia';
  if (platform === 'oc1') return 'sea';
  return 'americas';
}
