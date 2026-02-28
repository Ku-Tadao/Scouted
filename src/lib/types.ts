/* ═══════════════════════════════════════════
   TFT Types — Scouted
   ═══════════════════════════════════════════ */

export interface TFTChampion {
  name: string;
  championId: string;
  cost: 1 | 2 | 3 | 4 | 5;
  traits: string[];
  ability: {
    name: string;
    desc: string;
    icon: string;
    variables: Record<string, number[]>;
  };
  stats: {
    hp: number;
    mana: number;
    initialMana: number;
    armor: number;
    magicResist: number;
    damage: number;
    attackSpeed: number;
    critChance: number;
    range: number;
  };
  icon: string;
  tileIcon: string;
  splashUrl: string;
}

export interface TFTItem {
  id: number | null;
  name: string;
  desc: string;
  icon: string;
  category: 'component' | 'completed' | 'emblem' | 'artifact' | 'radiant' | 'support' | 'other';
  from?: string[];
  effects: Record<string, number>;
  uniqueId: string;
}

export interface TFTTrait {
  key: string;
  name: string;
  desc: string;
  icon: string;
  type: 'origin' | 'class' | 'unique' | 'teamup';
  style: number;
  effects: TraitEffect[];
  champions: { name: string; icon: string; id: string }[];
}

export interface TraitEffect {
  minUnits: number;
  maxUnits: number;
  style: number;
  variables: Record<string, number>;
}

export interface TFTAugment {
  id: string;
  name: string;
  desc: string;
  icon: string;
  tier: 1 | 2 | 3;
  associatedTraits?: string[];
}

export interface TFTLeaderboardEntry {
  summonerId: string;
  summonerName: string;
  leaguePoints: number;
  rank: string;
  wins: number;
  losses: number;
  puuid: string;
}

export interface TFTMatchParticipant {
  puuid: string;
  placement: number;
  level: number;
  goldLeft: number;
  lastRound: number;
  timeEliminated: number;
  totalDamageToPlayers: number;
  augments: string[];
  traits: {
    name: string;
    numUnits: number;
    style: number;
    tierCurrent: number;
    tierTotal: number;
  }[];
  units: {
    characterId: string;
    itemNames: string[];
    name: string;
    rarity: number;
    tier: number;
  }[];
  companion: {
    contentId: string;
    skinId: number;
    species: string;
  };
}

export interface TFTMatch {
  matchId: string;
  gameDatetime: number;
  gameLength: number;
  gameVersion: string;
  queueId: number;
  setCoreName: string;
  setNumber: number;
  participants: TFTMatchParticipant[];
}

export interface BuildInfo {
  generatedAt: string;
  patch: string;
  set: string;
}

export interface ScoutedData {
  champions: TFTChampion[];
  items: TFTItem[];
  traits: TFTTrait[];
  augments: TFTAugment[];
  buildInfo: BuildInfo;
}
