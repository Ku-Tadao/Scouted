export default {
  async fetch(request, env) {
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
            summonerName: entry.summonerName || 'Unknown',
            leaguePoints: Number(entry.leaguePoints || 0),
            wins: Number(entry.wins || 0),
            losses: Number(entry.losses || 0),
          }))
      : [];

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
