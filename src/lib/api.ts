import type { TFTChampion, TFTItem, TFTTrait, TFTAugment, ScoutedData } from './types';

/**
 * Scouted — TFT Data Fetching
 *
 * Uses Community Dragon (cdragon) and Data Dragon (ddragon)
 * for static TFT data. Riot's TFT API endpoints are used
 * client-side for live data (leaderboard, match history).
 *
 * The current set is auto-detected from Community Dragon data
 * so the site always stays up-to-date when a new set releases.
 */

const CDRAGON_BASE = 'https://raw.communitydragon.org/latest';
const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com';

/** Convert cdragon asset paths to full URLs */
function assetUrl(path: string | undefined | null): string {
  if (!path) return '';
  return `${CDRAGON_BASE}/game/${path.toLowerCase().replace('.dds', '.png').replace('.tex', '.png')}`;
}

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

/** Fetch the latest patch version string (e.g. "16.4.1") */
async function fetchLatestPatch(): Promise<string> {
  const versions = await fetchJSON<string[]>(`${DDRAGON_BASE}/api/versions.json`);
  return versions?.[0] ?? 'unknown';
}

// ── NPC / non-playable champion filtering ──

/** apiName patterns that are never playable champions */
const NPC_PATTERNS = [
  /^TFT_Item/i, /^TFT\d*_Armory/i, /^TFT_Assist/i,
  /Voidling/i, /Soldier$/i, /Invention$/i, /Dummy/i,
  /^TFT_Krug/i, /^TFT_Elder/i, /^TFT_BlueGolem/i,
  /^TFT\d+_Atakhan/i, /^TFT\d+_Freljord/i,
  /Scuttler/i, /Minion/i, /Chest$/i, /Tibbers/i,
  /^TFT5_Emblem/i, /^TFT\d+_NPC/i, /Drone/i,
];

function isNPC(c: any): boolean {
  const cost = c.cost ?? c.tier ?? 1;
  if (cost > 5) return true;
  const api = c.apiName ?? c.character_id ?? '';
  if (NPC_PATTERNS.some(p => p.test(api))) return true;
  // Champions with cost <= 5 but no traits and no meaningful ability
  if ((c.traits ?? []).length === 0 && cost <= 1) return true;
  return false;
}

// ── Parsers ──

function parseCDragonChampions(raw: any[]): TFTChampion[] {
  return raw
    .filter((c: any) => c.name && !isNPC(c))
    .map((c: any) => {
      const cost = c.cost ?? c.tier ?? 1;
      return {
        name: c.name ?? '',
        championId: c.apiName ?? c.character_id ?? '',
        cost: Math.min(Math.max(cost, 1), 5) as 1 | 2 | 3 | 4 | 5,
        traits: (c.traits ?? []) as string[],
        ability: {
          name: c.ability?.name ?? '',
          desc: c.ability?.desc ?? '',
          icon: assetUrl(c.ability?.icon),
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
        icon: assetUrl(c.icon),
        tileIcon: assetUrl(c.tileIcon),
        splashUrl: assetUrl(c.squareIcon),
      };
    })
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

/**
 * Classify traits into origin/class/unique based on their data.
 * cdragon doesn't provide type info, so we infer it:
 * - unique: single champion trait (1 breakpoint at minUnits=1)
 * - teamup: apiName contains "Teamup" (2-champion synergy)
 * - origin: region traits (breakpoints start at 3+)
 * - class: combat role traits (breakpoints start at 2)
 */
function classifyTraitType(t: any): 'origin' | 'class' | 'unique' | 'teamup' {
  const api = (t.apiName ?? '') as string;
  const effects = (t.effects ?? []) as any[];
  const breakpoints = effects.map((e: any) => e.minUnits ?? 0).filter((n: number) => n > 0);

  if (api.includes('Teamup')) return 'teamup';
  if (breakpoints.length <= 1 && breakpoints[0] <= 2) return 'unique';
  if (breakpoints[0] >= 3) return 'origin';
  return 'class';
}

function parseCDragonTraits(raw: any[]): TFTTrait[] {
  return raw
    .filter((t: any) => t.name && !t.name.startsWith('TFT_Template'))
    .map((t: any) => ({
      key: t.apiName ?? t.name ?? '',
      name: t.name ?? '',
      desc: t.desc ?? '',
      icon: assetUrl(t.icon),
      type: classifyTraitType(t),
      style: t.style ?? 0,
      effects: (t.effects ?? []).map((e: any) => ({
        minUnits: e.minUnits ?? 0,
        maxUnits: e.maxUnits ?? 999,
        style: e.style ?? 0,
        variables: e.variables ?? {},
      })),
      champions: [] as { name: string; icon: string }[],
    }))
    .sort((a, b) => {
      // Sort: origins first, then classes, then unique/teamup
      const order = { origin: 0, class: 1, teamup: 2, unique: 3 };
      const diff = (order[a.type] ?? 4) - (order[b.type] ?? 4);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });
}

/**
 * Parse items by resolving set-specific item refs against the top-level items array.
 * Categories are determined by composition, apiName patterns, and name patterns.
 */
function parseSetItems(setItemRefs: string[], allItems: any[]): TFTItem[] {
  // Build a lookup map for fast resolution
  const itemMap = new Map<string, any>();
  allItems.forEach(i => { if (i.apiName) itemMap.set(i.apiName, i); });

  // Known component apiNames
  const COMPONENT_APIS = new Set([
    'TFT_Item_BFSword', 'TFT_Item_RecurveBow', 'TFT_Item_NeedlesslyLargeRod',
    'TFT_Item_TearOfTheGoddess', 'TFT_Item_ChainVest', 'TFT_Item_NegatronCloak',
    'TFT_Item_GiantsBelt', 'TFT_Item_Spatula', 'TFT_Item_SparringGloves',
    'TFT_Item_FryingPan',
  ]);

  const results: TFTItem[] = [];
  const seen = new Set<string>();

  for (const ref of setItemRefs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const raw = itemMap.get(ref);
    if (!raw) continue;

    const name = raw.name ?? '';
    const api = raw.apiName ?? ref;

    // Skip unnamed, placeholder, consumable, champion items, armory grants
    if (!name || name.includes('@') || name.startsWith('tft_item_name_')) continue;
    if (api.includes('ChampionItem') || api.includes('Consumable') || api.includes('CypherArmory')) continue;
    if (api.includes('Grant') || api.includes('Assist_')) continue;

    const composition = raw.composition ?? [];
    const desc = raw.desc ?? '';
    const isComponent = COMPONENT_APIS.has(api);
    const isCompleted = !isComponent && composition.length === 2;
    const isEmblem = name.includes('Emblem');
    const isArtifact = api.includes('Artifact');
    // Use description tag as authoritative for support (some support items have 'Radiant' in apiName)
    const isSupport = desc.includes('[Support item]');
    // Only classify as radiant if the name actually starts with "Radiant" (not just apiName pattern)
    const isRadiant = name.startsWith('Radiant ');

    results.push({
      id: raw.id ?? null,
      name,
      desc,
      icon: assetUrl(raw.icon),
      category: isComponent ? 'component'
        : isSupport ? 'support'
        : isEmblem ? 'emblem'
        : isArtifact ? 'artifact'
        : isRadiant ? 'radiant'
        : isCompleted ? 'completed'
        : 'other',
      from: composition,
      effects: raw.effects ?? {},
      uniqueId: api,
    });
  }

  // Sort: components first, then completed, emblems, artifacts, radiant, support, other
  const catOrder: Record<string, number> = {
    component: 0, completed: 1, emblem: 2, artifact: 3, radiant: 4, support: 5, other: 9,
  };
  return results.sort((a, b) => (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9) || a.name.localeCompare(b.name));
}

/**
 * Resolve augment references (string apiNames) against the top-level items array.
 * Tier is determined from the icon filename: -I/-II/-III or _I/_II/_III suffix.
 */
function resolveAugments(augRefs: string[], allItems: any[]): TFTAugment[] {
  const itemMap = new Map<string, any>();
  allItems.forEach(i => { if (i.apiName) itemMap.set(i.apiName, i); });

  return augRefs
    .map(ref => {
      const raw = itemMap.get(ref);
      if (!raw || !raw.name) return null;

      const iconFile = (raw.icon ?? '').split('/').pop() ?? '';
      let tier: 1 | 2 | 3 = 2; // default gold
      if (/[-_]III[._]/i.test(iconFile)) tier = 3;
      else if (/[-_]II[._]/i.test(iconFile)) tier = 2;
      else if (/[-_]I[._]/i.test(iconFile)) tier = 1;

      return {
        id: raw.apiName ?? ref,
        name: raw.name ?? '',
        desc: raw.desc ?? '',
        icon: assetUrl(raw.icon),
        tier,
        associatedTraits: raw.associatedTraits ?? [],
      } as TFTAugment;
    })
    .filter((a): a is TFTAugment => a !== null)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

// ── Main fetch ──

/**
 * Fetch all TFT data from Community Dragon.
 * Returns structured data for build-time rendering.
 */
export async function fetchAllData(): Promise<ScoutedData> {
  const patch = await fetchLatestPatch();

  const tftData = await fetchJSON<any>(
    `${CDRAGON_BASE}/cdragon/tft/en_us.json`
  );

  let champions: TFTChampion[] = [];
  let items: TFTItem[] = [];
  let traits: TFTTrait[] = [];
  let augments: TFTAugment[] = [];
  let setDisplay = 'Unknown';

  if (tftData) {
    const setData = tftData.setData ?? tftData.sets;

    // Auto-detect the latest STANDARD set (not PVE/TURBO/PAIRS variants)
    let currentSet: any = null;

    if (Array.isArray(setData)) {
      // Find the highest set number, preferring the standard mutator (TFTSetN, not TFTSetN_PVEMODE etc.)
      const maxNum = Math.max(...setData.map((s: any) => s.number ?? 0));
      const candidates = setData.filter((s: any) => (s.number ?? 0) === maxNum);
      // Prefer the standard variant (shortest mutator name without underscore suffix)
      currentSet = candidates.find((s: any) => {
        const m = (s.mutator ?? '') as string;
        return !m.includes('_') || m === `TFTSet${maxNum}`;
      }) ?? candidates.find((s: any) => {
        const m = (s.mutator ?? '') as string;
        return m === `TFTSet${maxNum}`;
      }) ?? candidates[0];
    } else if (setData && typeof setData === 'object') {
      const keys = Object.keys(setData);
      const sorted = keys.sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });
      currentSet = setData[sorted[sorted.length - 1]];
    }

    if (currentSet) {
      const parsedNum = parseInt((currentSet.mutator ?? '').replace(/\D/g, ''), 10) || 0;
      const setNum = currentSet.number ?? (parsedNum || null);
      setDisplay = setNum ? `Set ${setNum}` : (currentSet.name ?? 'Latest');

      console.log(`[Scouted] Auto-detected ${setDisplay} (mutator: ${currentSet.mutator ?? 'n/a'}, champions: ${(currentSet.champions ?? []).length})`);

      // ── Champions ──
      champions = parseCDragonChampions(currentSet.champions ?? []);

      // ── Traits ──
      traits = parseCDragonTraits(currentSet.traits ?? []);

      // Link champions to traits (with icon info for display)
      champions.forEach((champ) => {
        champ.traits.forEach((traitName) => {
          const trait = traits.find((t) =>
            t.name === traitName || t.key.toLowerCase().includes(traitName.toLowerCase().replace(/ /g, ''))
          );
          if (trait && !trait.champions.some(c => c.name === champ.name)) {
            trait.champions.push({ name: champ.name, icon: champ.tileIcon || champ.icon });
          }
        });
      });

      // ── Items (set-specific refs → resolved from top-level items) ──
      const setItemRefs: string[] = Array.isArray(currentSet.items) && typeof currentSet.items[0] === 'string'
        ? currentSet.items
        : [];
      items = parseSetItems(setItemRefs, tftData.items ?? []);

      // ── Augments (set-specific refs → resolved from top-level items) ──
      const augRefs: string[] = Array.isArray(currentSet.augments) && typeof currentSet.augments[0] === 'string'
        ? currentSet.augments
        : [];
      augments = resolveAugments(augRefs, tftData.items ?? []);
    }
  }

  console.log(`[Scouted] Final: ${champions.length} champions, ${items.length} items, ${traits.length} traits, ${augments.length} augments`);

  return {
    champions,
    items,
    traits,
    augments,
    buildInfo: {
      generatedAt: new Date().toISOString(),
      patch,
      set: setDisplay,
    },
  };
}
