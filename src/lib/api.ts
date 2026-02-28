import type { TFTChampion, TFTItem, TFTTrait, TFTAugment, ScoutedData, TraitDetailRow } from './types';

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
          hp: c.stats?.hp ?? 0,
          mana: c.stats?.mana ?? 0,
          initialMana: c.stats?.initialMana ?? 0,
          armor: c.stats?.armor ?? 0,
          magicResist: c.stats?.magicResist ?? 0,
          damage: c.stats?.damage ?? 0,
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
 * Format a number for display: round to 2 decimals max, strip trailing zeros.
 */
function formatNum(n: number): string {
  if (n == null) return '?';
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

/**
 * Resolve @Variable@ and @Variable*N@ tokens in text using an effect's variables.
 */
function resolveVarsInText(text: string, effect: { minUnits: number; maxUnits: number; variables: Record<string, number> }): string {
  return text.replace(/@([^@]+)@/g, (_match, token: string) => {
    if (token === 'MinUnits') return String(effect.minUnits);
    if (token === 'MaxUnits') return String(effect.maxUnits);
    // Skip TFTUnitProperty (runtime game state)
    if (token.startsWith('TFTUnitProperty')) return '';
    // Handle @Var*N@ multiplication pattern
    const multMatch = token.match(/^(.+)\*(\d+)$/);
    if (multMatch) {
      const val = effect.variables[multMatch[1]];
      if (val != null) return formatNum(val * Number(multMatch[2]));
      return '?';
    }
    // Simple variable lookup
    const val = effect.variables[token];
    if (val != null) return formatNum(val);
    return '?';
  });
}

/** Map %i:icon% tokens to readable stat labels. */
const ICON_LABELS: Record<string, string> = {
  scaleAD: 'AD',
  scaleAP: 'AP',
  scaleAS: 'Attack Speed',
  scaleArmor: 'Armor',
  scaleCrit: 'Crit Chance',
  scaleCritMult: 'Crit Damage',
  scaleDA: 'Damage Amp',
  scaleDR: 'Damage Reduction',
  scaleHealth: 'Health',
  scaleMR: 'Magic Resist',
  scaleSV: 'Omnivamp',
};

/**
 * Clean a line of text: replace icon tokens with labels, strip HTML, orphaned formatting.
 */
function cleanLine(s: string): string {
  return s
    .replace(/%i:([^%]+)%/g, (_m, icon: string) => ICON_LABELS[icon] ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\(\?\)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+,/g, ',')        // fix " ," → ","
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Test if a line is garbage and should be discarded.
 */
function isGarbageLine(s: string): boolean {
  if (!s) return true;
  if (/^[^:]+:\s*[^a-zA-Z]*$/.test(s)) return true;
  if (!/[a-zA-Z]/.test(s) && !s.startsWith('(')) return true;
  return false;
}

/**
 * Resolve a trait description by substituting variables from effects.
 * Returns { summary, details } where summary is plain text and details
 * are structured breakpoint rows (style + text).
 */
function resolveTraitDesc(rawDesc: string, effects: Array<{ minUnits: number; maxUnits: number; style: number; variables: Record<string, number> }>): { summary: string; details: TraitDetailRow[] } {
  const empty = { summary: rawDesc || '', details: [] as TraitDetailRow[] };
  if (!rawDesc || effects.length === 0) return empty;

  const detailRows: TraitDetailRow[] = [];
  let desc = rawDesc;

  // 0. Strip runtime-only @TFTUnitProperty...@ tokens and their surrounding context.
  //    These track in-game state (serpents, souls, forging progress, etc.) and can't
  //    be resolved at build time. Remove the tokens, their labels, and <rules> wrappers.
  desc = desc.replace(/<rules>[^<]*@TFTUnitProperty[^<]*<\/rules>/gi, '');
  desc = desc.replace(/[^<\n]*@TFTUnitProperty[^@]*@[^<\n]*/gi, '');
  desc = desc.replace(/Current (?:Bonus Stats|Stats|Serpents)\s*:?/gi, '');

  /** Strip leading \"(number) \" prefix from a detail row since the badge shows it. */
  function stripLeadingUnits(s: string): string {
    return s.replace(/^\(\d+\)\s*/, '').replace(/^,\s*/, '').trim();
  }

  // 1. Extract <expandRow> templates → one detail row per effect
  desc = desc.replace(/<expandRow>(.*?)<\/expandRow>/gi, (_m, template: string) => {
    effects.forEach((e) => {
      const resolved = stripLeadingUnits(cleanLine(resolveVarsInText(template, e)));
      if (resolved) {
        detailRows.push({ style: e.style, minUnits: e.minUnits, text: resolved });
      }
    });
    return ''; // remove from desc
  });

  // 2. Extract <row> entries → one detail row each, mapped to effects in order
  let rowIdx = 0;
  desc = desc.replace(/<row>(.*?)<\/row>/gi, (_m, rowText: string) => {
    const effect = effects[rowIdx] ?? effects[effects.length - 1];
    const resolved = stripLeadingUnits(cleanLine(resolveVarsInText(rowText, effect)));
    if (resolved) {
      detailRows.push({ style: effect.style, minUnits: effect.minUnits, text: resolved });
    }
    rowIdx++;
    return ''; // remove from desc
  });

  // 3. Resolve remaining @var@ tokens using the first effect
  desc = resolveVarsInText(desc, effects[0]);

  // 4. Clean the summary text
  const summaryLines = desc.split(/<br\s*\/?>/i)
    .map(cleanLine)
    .filter(s => !isGarbageLine(s));
  let summary = summaryLines.join('<br>').replace(/(<br\s*\/?>[\s]*){3,}/gi, '<br><br>')
    .replace(/^(<br\s*\/?>[\s]*)+/gi, '').replace(/(<br\s*\/?>[\s]*)+$/gi, '').trim();

  // 4b. If description was entirely <row> elements, summary is now empty.
  //     Use the first detail row's text as the summary so there's always visible text.
  //     Keep the row in detailRows so its breakpoint badge still appears when expanded.
  if (!summary && detailRows.length > 0) {
    summary = detailRows[0].text;
  }

  // 5. Colorize slash-separated numbers (e.g. 350/600/2000 → star-level colors)
  const starColors = ['#a67c52', '#94a3b8', '#e6a030', '#e84e4e'];
  summary = summary.replace(/\b(\d+(?:\.\d+)?(?:%?))((?:\/\d+(?:\.\d+)?(?:%?)){1,3})\b/g, (full) => {
    const parts = full.split('/');
    return parts.map((p, i) => {
      const color = starColors[Math.min(i, starColors.length - 1)];
      return `<span style="color:${color};font-weight:600">${p}</span>`;
    }).join('<span style="color:var(--muted)">/</span>');
  });

  // 6. Colorize stat keywords (League-style tooltip colors)
  // Longer phrases first; use placeholders to prevent double-wrapping
  const statKeywords: Array<[RegExp, string]> = [
    [/\b(max(?:imum)?\s+Health)\b/gi, '#2dd4bf'],
    [/\b(Critical Strike Chance)\b/gi, '#f87171'],
    [/\b(Critical Strike Damage)\b/gi, '#f87171'],
    [/\b(Critical Strike)\b/gi, '#f87171'],
    [/\b(Damage Reduction)\b/gi, '#eab308'],
    [/\b(Magic Resist)\b/gi, '#818cf8'],
    [/\b(Attack Damage)\b/gi, '#fb923c'],
    [/\b(Ability Power)\b/gi, '#c084fc'],
    [/\b(Attack Speed)\b/gi, '#a3e635'],
    [/\b(Mana Regen)\b/gi, '#60a5fa'],
    [/\b(Crit Chance)\b/gi, '#f87171'],
    [/\b(Crit Damage)\b/gi, '#f87171'],
    [/\b(Magic Damage)\b/gi, '#a78bfa'],
    [/\b(Damage Amp)\b/gi, '#a78bfa'],
    [/\b(Omnivamp)\b/gi, '#fb7185'],
    [/\b(Durability)\b/gi, '#eab308'],
    [/\b(Health)\b/gi, '#2dd4bf'],
    [/\b(Armor)\b/gi, '#eab308'],
    [/\b(Shield)\b/gi, '#fbbf24'],
    [/\b(Mana)\b/g, '#60a5fa'],
    [/\b(AD)\b/g, '#fb923c'],
    [/\b(AP)\b/g, '#c084fc'],
  ];
  const placeholders: string[] = [];
  for (const [re, color] of statKeywords) {
    summary = summary.replace(re, (m) => {
      const idx = placeholders.length;
      placeholders.push(`<span style="color:${color}">${m}</span>`);
      return `\x00STAT${idx}\x00`;
    });
  }
  // Restore placeholders
  summary = summary.replace(/\x00STAT(\d+)\x00/g, (_m, idx) => placeholders[Number(idx)]);

  return { summary, details: detailRows };
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
    .map((t: any) => {
      const effects = (t.effects ?? []).map((e: any) => ({
        minUnits: e.minUnits ?? 0,
        maxUnits: e.maxUnits ?? 999,
        style: e.style ?? 0,
        variables: e.variables ?? {},
      }));
      const { summary, details } = resolveTraitDesc(t.desc ?? '', effects);
      return {
        key: t.apiName ?? t.name ?? '',
        name: t.name ?? '',
        desc: summary,
        descDetails: details,
        icon: assetUrl(t.icon),
        type: classifyTraitType(t),
        style: t.style ?? 0,
        effects,
        champions: [] as { name: string; icon: string; id: string }[],
      };
    })
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
 * Tier is determined from item tags (hashed CDragon tag IDs):
 *   {d11fd6d5} = Silver (1), {ce1fd21c} = Gold (2), {cf1fd3af} = Prismatic (3)
 * Falls back to icon filename pattern (-I/-II/-III) if no tag match.
 */
const AUGMENT_TIER_TAGS: Record<string, 1 | 2 | 3> = {
  '{d11fd6d5}': 1, // Silver
  '{ce1fd21c}': 2, // Gold
  '{cf1fd3af}': 3, // Prismatic
};

function resolveAugments(augRefs: string[], allItems: any[]): TFTAugment[] {
  const itemMap = new Map<string, any>();
  allItems.forEach(i => { if (i.apiName) itemMap.set(i.apiName, i); });

  return augRefs
    .map(ref => {
      const raw = itemMap.get(ref);
      if (!raw || !raw.name) return null;

      // Determine tier from tags first (most reliable)
      let tier: 1 | 2 | 3 = 2; // default gold
      const tags: string[] = raw.tags ?? [];
      const tagTier = tags.find(t => t in AUGMENT_TIER_TAGS);
      if (tagTier) {
        tier = AUGMENT_TIER_TAGS[tagTier];
      } else {
        // Fallback: icon filename pattern
        const iconFile = (raw.icon ?? '').split('/').pop() ?? '';
        if (/[-_]III[._]/i.test(iconFile)) tier = 3;
        else if (/[-_]II[._]/i.test(iconFile)) tier = 2;
        else if (/[-_]I[._]/i.test(iconFile)) tier = 1;
      }

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
            trait.champions.push({ name: champ.name, icon: champ.tileIcon || champ.icon, id: champ.championId });
          }
        });
      });

      // Link team-up traits from apiName (e.g. TFT16_Teamup_EkkoZilean → Ekko, Zilean)
      traits.filter(t => t.type === 'teamup' && t.champions.length === 0).forEach((trait) => {
        const suffix = trait.key.split('_').pop() ?? '';
        const names = suffix.match(/[A-Z][a-z]+/g) ?? [];
        names.forEach((partial) => {
          const champ = champions.find(c => c.name.includes(partial));
          if (champ && !trait.champions.some(c => c.name === champ.name)) {
            trait.champions.push({ name: champ.name, icon: champ.tileIcon || champ.icon, id: champ.championId });
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
