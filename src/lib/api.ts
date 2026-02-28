import type { TFTChampion, TFTItem, TFTTrait, TFTAugment, ScoutedData } from './types';

/**
 * Scouted — TFT Data Fetching
 *
 * Uses Community Dragon (cdragon) and Data Dragon (ddragon)
 * for static TFT data. Riot's TFT API endpoints are used
 * client-side for live data (leaderboard, match history).
 *
 * Current set: TFT Set 16 (as of Feb 2026)
 */

const CDRAGON_BASE = 'https://raw.communitydragon.org/latest';
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

// Current TFT set identifier — update when a new set releases
const CURRENT_SET = 'TFTSet16';
const CURRENT_SET_DISPLAY = 'Set 16';

async function fetchJSON<T>(url: string, retries = 2): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Scouted/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === retries) {
        console.error(`Failed to fetch ${url}:`, e);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  return null;
}

/**
 * Fetch the latest patch version string (e.g. "14.3.1")
 */
async function fetchLatestPatch(): Promise<string> {
  const versions = await fetchJSON<string[]>(`${DDRAGON_BASE}/api/versions.json`);
  return versions?.[0] ?? 'unknown';
}

/**
 * Parse Community Dragon TFT data into our clean types.
 * cdragon provides a single JSON with all champions, traits, items, augments.
 */
function parseCDragonChampions(raw: any[]): TFTChampion[] {
  return raw
    .filter((c: any) => c.name && c.name !== 'TFT_Template' && !c.name.startsWith('TFT_Dummy'))
    .map((c: any) => {
      const cost = c.tier ?? c.cost ?? 1;
      return {
        name: c.name?.replace(/^TFT\d+_/i, '').replace(/_/g, ' ') ?? c.character_id,
        championId: c.character_id ?? c.apiName ?? '',
        cost: Math.min(Math.max(cost, 1), 5) as 1 | 2 | 3 | 4 | 5,
        traits: (c.traits ?? []).map((t: string) =>
          t.replace(/^Set\d+_/i, '').replace(/_/g, ' ')
        ),
        ability: {
          name: c.ability?.name ?? '',
          desc: c.ability?.desc ?? '',
          icon: c.ability?.icon
            ? `${CDRAGON_BASE}/game/${c.ability.icon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
            : '',
          variables: c.ability?.variables
            ? Object.fromEntries(
                (c.ability.variables as any[]).map((v: any) => [v.name, v.value])
              )
            : {},
        },
        stats: {
          hp: c.stats?.hp ? [c.stats.hp[0], c.stats.hp[1], c.stats.hp[2]] : [0, 0, 0],
          mana: c.stats?.mana ?? 0,
          initialMana: c.stats?.initialMana ?? 0,
          armor: c.stats?.armor ?? 0,
          magicResist: c.stats?.magicResist ?? 0,
          damage: c.stats?.damage ? [c.stats.damage[0], c.stats.damage[1], c.stats.damage[2]] : [0, 0, 0],
          attackSpeed: c.stats?.attackSpeed ?? 0,
          critChance: c.stats?.critChance ?? 0.25,
          range: c.stats?.range ?? 1,
        },
        icon: c.icon
          ? `${CDRAGON_BASE}/game/${c.icon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
          : '',
        tileIcon: c.tileIcon
          ? `${CDRAGON_BASE}/game/${c.tileIcon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
          : '',
        splashUrl: c.squareIconPath
          ? `${CDRAGON_BASE}/game/${c.squareIconPath.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
          : '',
      };
    })
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

function parseCDragonTraits(raw: any[]): TFTTrait[] {
  return raw
    .filter((t: any) => t.name && !t.name.startsWith('TFT_Template'))
    .map((t: any) => ({
      key: t.apiName ?? t.name ?? '',
      name: t.name ?? '',
      desc: t.desc ?? '',
      icon: t.icon
        ? `${CDRAGON_BASE}/game/${t.icon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
        : '',
      type: (t.type ?? 'origin') as 'origin' | 'class',
      style: t.style ?? 0,
      effects: (t.effects ?? []).map((e: any) => ({
        minUnits: e.minUnits ?? 0,
        maxUnits: e.maxUnits ?? 999,
        style: e.style ?? 0,
        variables: e.variables ?? {},
      })),
      champions: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseCDragonItems(raw: any[]): TFTItem[] {
  return raw
    .filter((i: any) => i.name && !i.name.includes('Template') && i.name !== 'null')
    .map((i: any) => ({
      id: i.id ?? 0,
      name: i.name ?? '',
      desc: i.desc ?? '',
      icon: i.icon
        ? `${CDRAGON_BASE}/game/${i.icon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
        : '',
      isComponent: (i.id ?? 0) >= 1 && (i.id ?? 0) <= 9,
      isCompleted: (i.id ?? 0) >= 10 && (i.id ?? 0) < 100,
      isRadiant: i.isRadiant ?? (i.name?.includes('Radiant') ?? false),
      isArtifact: i.isArtifact ?? false,
      isSupport: i.isSupport ?? false,
      from: i.from ?? i.composition ?? [],
      effects: i.effects ?? {},
      uniqueId: i.apiName ?? `item-${i.id}`,
    }))
    .sort((a, b) => a.id - b.id);
}

function parseCDragonAugments(raw: any[]): TFTAugment[] {
  return raw
    .filter((a: any) => a.name && !a.name.includes('Template'))
    .map((a: any) => ({
      id: a.apiName ?? a.nameId ?? '',
      name: a.name ?? '',
      desc: a.desc ?? '',
      icon: a.icon
        ? `${CDRAGON_BASE}/game/${a.icon.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`
        : '',
      tier: a.tier ?? (a.name?.includes('III') ? 3 : a.name?.includes('II') ? 2 : 1) as 1 | 2 | 3,
      associatedTraits: a.associatedTraits ?? [],
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/**
 * Fetch all TFT data from Community Dragon.
 * Returns structured data for build-time rendering.
 */
export async function fetchAllData(): Promise<ScoutedData> {
  const patch = await fetchLatestPatch();

  // Community Dragon TFT data endpoint
  const tftData = await fetchJSON<any>(
    `${CDRAGON_BASE}/cdragon/tft/en_us.json`
  );

  let champions: TFTChampion[] = [];
  let items: TFTItem[] = [];
  let traits: TFTTrait[] = [];
  let augments: TFTAugment[] = [];

  if (tftData) {
    // cdragon structures data under setData and items
    const setData = tftData.setData ?? tftData.sets;
    const currentSet = Array.isArray(setData)
      ? setData.find((s: any) => s.mutator === CURRENT_SET || s.number === 14)
      : setData?.[CURRENT_SET] ?? setData?.['14'] ?? Object.values(setData ?? {})?.[Object.keys(setData ?? {}).length - 1];

    if (currentSet) {
      champions = parseCDragonChampions(currentSet.champions ?? []);
      traits = parseCDragonTraits(currentSet.traits ?? []);

      // Link champions to traits
      champions.forEach((champ) => {
        champ.traits.forEach((traitName) => {
          const trait = traits.find((t) => t.name === traitName || t.key.includes(traitName.replace(/ /g, '')));
          if (trait && !trait.champions.includes(champ.name)) {
            trait.champions.push(champ.name);
          }
        });
      });
    }

    items = parseCDragonItems(tftData.items ?? []);

    // Augments may be under items with a specific flag, or a separate array
    if (tftData.augments) {
      augments = parseCDragonAugments(tftData.augments);
    }
  }

  return {
    champions,
    items,
    traits,
    augments,
    buildInfo: {
      generatedAt: new Date().toISOString(),
      patch,
      set: CURRENT_SET_DISPLAY,
    },
  };
}
