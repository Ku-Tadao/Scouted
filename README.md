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

## License

Not affiliated with or endorsed by Riot Games, Inc.

Teamfight Tactics and Riot Games are trademarks of Riot Games, Inc.
