# Scouted

A TFT (Teamfight Tactics) data hub — browse champions, items, traits, augments, and leaderboards.

Built with [Astro](https://astro.build) and deployed on GitHub Pages.

## Live

**[ku-tadao.github.io/Scouted](https://ku-tadao.github.io/Scouted/)**

## Features

- **Champions** — browse by cost, view stats, abilities, and traits
- **Items** — components, completed, radiant, and more
- **Traits** — origins and classes with breakpoints
- **Augments** — silver, gold, and prismatic tier filters
- **Leaderboard** — ranked data (requires Riot API key)
- **Dark / Light theme** with system preference detection

## Data Sources

| Source | Usage |
|--------|-------|
| [Community Dragon](https://communitydragon.org) | Champions, items, traits, augments (build-time) |
| [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) | Patch version |
| [Riot TFT API](https://developer.riotgames.com/apis#tft-league-v1) | Leaderboard, match data (runtime, requires key) |

## Stack

- **Astro 5** — static site generator
- **TypeScript** — type-safe data layer
- **Vanilla JS** — client-side interactivity
- **GitHub Pages** — hosting

## Development

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/
```

## Secure Riot API Proxy (Cloudflare Worker)

This site stays on GitHub Pages, while live Riot requests go through a Cloudflare Worker proxy.

1. Deploy worker script from [cloudflare/riot-proxy-worker.js](cloudflare/riot-proxy-worker.js)
2. In Cloudflare Worker settings, add secret: `RIOT_API_KEY`
3. Create a KV namespace (for snapshot + name cache), then bind it to the Worker as `SCOUTED_KV`
4. Add Worker Cron Trigger (every minute)
	- Use: `* * * * *`
	- The Worker itself starts refresh at **02:00 Europe/Amsterdam** and keeps retrying minute-by-minute until that day’s refresh is done.
5. In GitHub repo **Variables**, set: `PUBLIC_RIOT_PROXY_URL`
	- Example: `https://scouted-riot-proxy.<your-subdomain>.workers.dev`

The client only sees `PUBLIC_RIOT_PROXY_URL` (non-secret). The Riot API key remains server-side in Cloudflare.

### Daily refresh logic

- Worker refreshes all region/tier leaderboard snapshots during scheduled runs.
- Refresh starts at 02:00 Amsterdam local time and retries minute-by-minute, capped at 5 runs/day.
- Name lookups are rate-limited per run to stay under Riot thresholds and avoid Worker subrequest failures.
- Runtime `/leaderboard` reads KV snapshot first (fast + no Riot burst traffic).

## License

Not affiliated with or endorsed by Riot Games, Inc.

Teamfight Tactics and Riot Games are trademarks of Riot Games, Inc.
