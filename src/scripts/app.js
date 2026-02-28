/**
 * Scouted — Client-side interactivity
 *
 * Handles theme toggling, navigation, filtering,
 * champion detail modals, item modals, player search,
 * and leaderboard for TFT.
 */

// ── Globals ──
const dataEl = document.getElementById('app-data');
const DATA = dataEl ? JSON.parse(dataEl.dataset.payload || '{}') : {};

const state = {
  lbRegion: 'na1',
  lbTier: 'challenger',
};

// ── Utilities ──
const norm = (t) => (t || '').toString().toLowerCase().trim();
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ── Theme ──
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('sc-theme', t);
  const b = document.getElementById('themeToggle');
  if (b) b.textContent = t === 'dark' ? 'Light Mode' : 'Dark Mode';
}

function initTheme() {
  const s = localStorage.getItem('sc-theme');
  if (s) { setTheme(s); return; }
  setTheme(window.matchMedia?.('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
}

// ── Navigation ──
function setActiveNav(id) {
  document.querySelectorAll('.nav-link').forEach((b) =>
    b.classList.toggle('active', b.dataset.section === id)
  );
}

function showSection(id) {
  document.querySelectorAll('section.content').forEach((s) => {
    s.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (el) {
    el.style.display = '';
    setActiveNav(id);
  }
}

// ── Champion Search ──
function filterChampions(query) {
  const q = norm(query);
  document.querySelectorAll('.champ-card').forEach((c) => {
    const name = c.dataset.champName || '';
    c.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

// ── Champion Cost Filter ──
function filterByCost(cost) {
  document.querySelectorAll('.cost-filter').forEach((b) =>
    b.classList.toggle('active', b.dataset.cost === cost)
  );
  document.querySelectorAll('.champ-cost-group').forEach((g) => {
    if (cost === 'all') {
      g.style.display = '';
    } else {
      g.style.display = g.dataset.costGroup === cost ? '' : 'none';
    }
  });
}

// ── Item Search ──
function filterItems(query) {
  const q = norm(query);
  document.querySelectorAll('.item-card').forEach((c) => {
    const name = c.dataset.itemName || '';
    c.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

// ── Item Category Filter ──
function filterItemCategory(cat) {
  document.querySelectorAll('.item-cat-filter').forEach((b) =>
    b.classList.toggle('active', b.dataset.cat === cat)
  );
  document.querySelectorAll('.item-section').forEach((s) => {
    if (cat === 'all') {
      s.style.display = '';
    } else {
      s.style.display = s.dataset.itemCat === cat ? '' : 'none';
    }
  });
}

// ── Trait Search ──
function filterTraits(query) {
  const q = norm(query);
  document.querySelectorAll('.trait-card').forEach((c) => {
    const name = c.dataset.traitName || '';
    c.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

// ── Augment Search ──
function filterAugments(query) {
  const q = norm(query);
  document.querySelectorAll('.augment-card').forEach((c) => {
    const name = c.dataset.augName || '';
    c.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
}

// ── Augment Tier Filter ──
function filterAugmentTier(tier) {
  document.querySelectorAll('.aug-tier-filter').forEach((b) =>
    b.classList.toggle('active', b.dataset.tier === tier)
  );
  document.querySelectorAll('.augment-card').forEach((c) => {
    if (tier === 'all') {
      c.style.display = '';
    } else {
      c.style.display = c.dataset.augTier === tier ? '' : 'none';
    }
  });
}

// ── Champion Detail Modal ──
function findChampion(id) {
  return DATA.champions?.find((c) => c.championId === id);
}

function showChampionDetails(champId) {
  const champ = findChampion(champId);
  if (!champ) return;

  const modal = document.getElementById('champModal');
  const det = document.getElementById('modalChampDetails');
  det.innerHTML = '';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const costColors = { 1: 'var(--cost-1)', 2: 'var(--cost-2)', 3: 'var(--cost-3)', 4: 'var(--cost-4)', 5: 'var(--cost-5)' };
  const costBg = { 1: 'var(--cost-1-bg)', 2: 'var(--cost-2-bg)', 3: 'var(--cost-3-bg)', 4: 'var(--cost-4-bg)', 5: 'var(--cost-5-bg)' };
  const cc = costColors[champ.cost] || 'var(--brand)';
  const cb = costBg[champ.cost] || 'var(--brand-subtle)';

  let h = '';

  // Header
  h += '<div class="cd-header">';
  h += '<img class="cd-portrait" src="' + (champ.tileIcon || champ.icon) + '" alt="' + esc(champ.name) + '" style="border:3px solid ' + cc + '" />';
  h += '<div class="cd-info">';
  h += '<h2 class="cd-name" style="color:' + cc + '">' + esc(champ.name) + '</h2>';
  h += '<span class="cd-cost-pill" style="background:' + cb + ';color:' + cc + ';border:1px solid color-mix(in srgb,' + cc + ' 25%,transparent)">' + champ.cost + '-Cost</span>';
  h += '<div class="cd-traits-list">';
  champ.traits.forEach((t) => { h += '<span class="cd-trait-tag">' + esc(t) + '</span>'; });
  h += '</div>';
  h += '</div></div>';

  // Stats
  const s = champ.stats;
  const fmtAS = typeof s.attackSpeed === 'number' && !Number.isInteger(s.attackSpeed) && String(s.attackSpeed).split('.')[1]?.length > 2 ? s.attackSpeed.toFixed(2) : String(s.attackSpeed);
  h += '<div class="cd-stats-grid">';
  h += statCard('HP', s.hp);
  h += statCard('Mana', s.initialMana + ' / ' + s.mana);
  h += statCard('Damage', s.damage);
  h += statCard('Atk Spd', fmtAS);
  h += statCard('Armor', s.armor);
  h += statCard('MR', s.magicResist);
  h += statCard('Range', s.range);
  h += statCard('Crit', (s.critChance * 100).toFixed(0) + '%');
  h += '</div>';

  // Ability
  if (champ.ability && champ.ability.name) {
    h += '<div class="cd-ability-section"><h4>Ability</h4>';
    h += '<div class="cd-ability-box">';
    h += '<div class="cd-ability-header">';
    if (champ.ability.icon) h += '<img class="cd-ability-icon" src="' + champ.ability.icon + '" alt="' + esc(champ.ability.name) + '" loading="lazy" />';
    h += '<span class="cd-ability-name">' + esc(champ.ability.name) + '</span>';
    h += '</div>';
    if (champ.ability.desc) {
      let desc = champ.ability.desc;
      const vars = champ.ability.variables || {};

      // Build case-insensitive lookup map for variable names
      var varKeys = Object.keys(vars);
      var varKeysLower = {};
      varKeys.forEach(function(k) { varKeysLower[k.toLowerCase()] = k; });

      /**
       * Smart variable lookup: CDragon descriptions use prefixed tokens
       * like @ModifiedDamage@ or @TotalDamage@ but the raw variable names
       * are unprefixed (e.g. "Damage", "ADDamage"). This resolves them
       * through a series of fallback strategies.
       */
      function resolveVar(token) {
        // 1. Direct lookup
        if (vars[token]) return vars[token];
        // 1b. Case-insensitive direct lookup
        if (varKeysLower[token.toLowerCase()]) return vars[varKeysLower[token.toLowerCase()]];

        // 2. Strip known prefixes (may be stacked: FirstCastModifiedDamage)
        var prefixRe = /^(Modified|Total|Reduced|Bonus|FirstCast|SecondCast|ThirdCast)/;
        var stripped = token;
        while (prefixRe.test(stripped)) {
          stripped = stripped.replace(prefixRe, '');
        }
        if (stripped && stripped !== token) {
          if (vars[stripped]) return vars[stripped];
          if (varKeysLower[stripped.toLowerCase()])
            return vars[varKeysLower[stripped.toLowerCase()]];

          // 3. After stripping, try AD/AP/Flat/Base/Percent prefix variants
          var prefixes = ['AP', 'AD', 'Flat', 'Base', 'Percent'];
          for (var pi = 0; pi < prefixes.length; pi++) {
            var candidate = prefixes[pi] + stripped;
            if (vars[candidate]) return vars[candidate];
            if (varKeysLower[candidate.toLowerCase()])
              return vars[varKeysLower[candidate.toLowerCase()]];
          }

          // 3b. Try inserting AD/AP before "Damage" within compound names
          //     e.g. "DivebombDamage" → "DivebombADDamage"
          if (/Damage/i.test(stripped)) {
            for (var di = 0; di < prefixes.length; di++) {
              var infixed = stripped.replace(/Damage/i, prefixes[di] + 'Damage');
              if (vars[infixed]) return vars[infixed];
              if (varKeysLower[infixed.toLowerCase()])
                return vars[varKeysLower[infixed.toLowerCase()]];
            }
          }

          // 4. Handle _Suffix pattern: @ModifiedDamage_Q@ → QDamage
          var suffixMatch = stripped.match(/^(.+?)_(\w+)$/);
          if (suffixMatch) {
            var rearranged = suffixMatch[2] + suffixMatch[1];
            if (vars[rearranged]) return vars[rearranged];
            if (varKeysLower[rearranged.toLowerCase()])
              return vars[varKeysLower[rearranged.toLowerCase()]];
          }
        }

        // 5. Fuzzy: find a variable whose name ends with the token (after stripping)
        var search = (stripped && stripped !== token ? stripped : token).toLowerCase();
        for (var fi = 0; fi < varKeys.length; fi++) {
          var vk = varKeys[fi].toLowerCase();
          if (vk.endsWith(search) || search.endsWith(vk)) return vars[varKeys[fi]];
        }

        // 6. Substring containment: find variable name contained in token or vice versa
        //    Prefer longest match
        var bestMatch = null;
        var bestLen = 0;
        for (var si = 0; si < varKeys.length; si++) {
          var vkl = varKeys[si].toLowerCase();
          if (search.includes(vkl) && vkl.length > bestLen) {
            bestMatch = varKeys[si];
            bestLen = vkl.length;
          } else if (vkl.includes(search) && search.length > bestLen) {
            bestMatch = varKeys[si];
            bestLen = search.length;
          }
        }
        if (bestMatch) return vars[bestMatch];

        // 7. Word-segment overlap: split camelCase into words, find the variable
        //    that shares the most words. Resolves e.g. MinDamage → MinAOEDamage,
        //    AOEDamage → MagicDamageAOE, ActiveDamage → ActiveMRDamage
        var originalForSplit = stripped && stripped !== token ? stripped : token;
        var words = originalForSplit.replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
          .toLowerCase().split(/\s+/);
        if (words.length >= 2) {
          var bestWordMatch = null;
          var bestWordScore = 0;
          for (var wi = 0; wi < varKeys.length; wi++) {
            var vWords = varKeys[wi].replace(/([a-z])([A-Z])/g, '$1 $2')
              .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
              .toLowerCase().split(/\s+/);
            var overlap = 0;
            for (var wj = 0; wj < words.length; wj++) {
              if (vWords.indexOf(words[wj]) !== -1) overlap++;
            }
            if (overlap > bestWordScore) {
              bestWordScore = overlap;
              bestWordMatch = varKeys[wi];
            }
          }
          if (bestWordMatch && bestWordScore >= 2) return vars[bestWordMatch];
        }

        return null;
      }

      // Resolve @VarName@ and @VarName*N@ tokens using ability variables
      desc = desc.replace(/@([^@]+)@/g, function(_m, token) {
        // Skip TFTUnitProperty (runtime game state, can't resolve statically)
        if (token.startsWith('TFTUnitProperty')) return '';
        // Handle multiplication: @VarName*100@ → VarName × 100
        var multMatch = token.match(/^(.+?)\*(\d+(?:\.\d+)?)$/);
        var varName = multMatch ? multMatch[1] : token;
        var mult = multMatch ? parseFloat(multMatch[2]) : 1;
        var vals = resolveVar(varName);
        if (!vals || !Array.isArray(vals)) return '?';
        // Star levels at indices 1 (1★), 2 (2★), 3 (3★)
        var starVals = [vals[1], vals[2], vals[3]].map(function(v) {
          if (v == null) return null;
          var n = v * mult;
          return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, '');
        }).filter(function(v) { return v !== null; });
        if (starVals.length === 0) return '?';
        // If all values are the same, show just one
        if (starVals.every(function(v) { return v === starVals[0]; })) return starVals[0];
        // Show as star-level breakdown with colors
        var colors = ['#a67c52', '#94a3b8', '#e6a030'];
        return starVals.map(function(v, i) {
          return '<span style="color:' + colors[i] + ';font-weight:600">' + v + '</span>';
        }).join('<span style="color:var(--muted)">/</span>');
      });

      // Resolve {{TFT_Keyword_X}} tags with readable descriptions
      var keywordDefs = {
        'TFT_Keyword_Chill': '<span class="kw-tag">Chill</span>: Reduce attack speed by 30%',
        'TFT_Keyword_Shred': '<span class="kw-tag">Shred</span>: Reduce Magic Resist by 40% for 5 seconds',
        'TFT_Keyword_Wound': '<span class="kw-tag">Wound</span>: Reduce healing received by 33% for 5 seconds',
        'TFT_Keyword_Burn': '<span class="kw-tag">Burn</span>: Deal 2% max Health true damage over 5 seconds. Reduce healing by 33%',
        'TFT_Keyword_Sunder': '<span class="kw-tag">Sunder</span>: Reduce Armor by 40% for 5 seconds',
      };
      desc = desc.replace(/\{\{([^}]+)\}\}/g, function(_m, kw) {
        return keywordDefs[kw] || '';
      });

      // Replace %i:icon% tokens with styled stat icons
      var statIcons = {
        scaleAD: { label: 'AD', color: '#fb923c', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>' },
        scaleAP: { label: 'AP', color: '#c084fc', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
        scaleAS: { label: 'AS', color: '#a3e635', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
        scaleArmor: { label: 'Armor', color: '#eab308', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
        scaleMR: { label: 'MR', color: '#818cf8', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8l1.5 3H15l-1.5 2L15 16h-2l-1-2-1 2H9l1.5-3L9 11h1.5z"/></svg>' },
        scaleHealth: { label: 'HP', color: '#2dd4bf', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' },
        scaleCrit: { label: 'Crit', color: '#f87171', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>' },
        scaleCritMult: { label: 'Crit Dmg', color: '#f87171', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>' },
        scaleDA: { label: 'Dmg Amp', color: '#a78bfa', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
        scaleDR: { label: 'DR', color: '#eab308', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
        scaleSV: { label: 'Omnivamp', color: '#fb7185', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' },
        scaleSouls: { label: 'Souls', color: '#67e8f9', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="10" r="7"/><path d="M8 17c0 2.2 1.8 4 4 4s4-1.8 4-4"/></svg>' },
        TFTBaseAD: { label: 'AD', color: '#fb923c', svg: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>' },
      };
      desc = desc.replace(/%i:([^%]+)%/g, function(_m, icon) {
        var info = statIcons[icon];
        if (!info) return '';
        return '<span class="stat-icon" style="color:' + info.color + '">' + info.svg + '<span>' + info.label + '</span></span>';
      });
      // Strip inline HTML tags (but keep our injected spans), clean &nbsp;
      desc = desc.replace(/<(?!\/?span\b)[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
      // Clean up orphaned empty parens and double spaces from removed tokens
      desc = desc.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      h += '<p class="cd-ability-desc">' + desc + '</p>';
    }
    h += '</div></div>';
  }

  det.innerHTML = h;
}

function statCard(label, value) {
  return '<div class="cd-stat"><div class="cd-stat-value">' + esc(String(value)) + '</div><div class="cd-stat-label">' + esc(label) + '</div></div>';
}

function closeChampModal() {
  const m = document.getElementById('champModal');
  m.classList.add('hidden');
  m.setAttribute('aria-hidden', 'true');
}

// ── Item Detail Modal ──
function findItem(id) {
  return DATA.items?.find((i) => i.uniqueId === id);
}

function showItemDetails(itemId) {
  const item = findItem(itemId);
  if (!item) return;

  const modal = document.getElementById('itemModal');
  const det = document.getElementById('modalItemDetails');
  det.innerHTML = '';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  let h = '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">';
  if (item.icon) h += '<img src="' + item.icon + '" alt="" style="width:64px;height:64px;border-radius:10px;border:2px solid var(--border)" />';
  h += '<div><h3 style="margin:0;font-family:Exo 2,system-ui;text-transform:uppercase;letter-spacing:.03em">' + esc(item.name) + '</h3>';
  const catLabels = { component: 'Component', completed: 'Completed', emblem: 'Emblem', artifact: 'Artifact', radiant: 'Radiant', support: 'Support', other: 'Item' };
  const type = catLabels[item.category] || 'Item';
  h += '<span style="font-size:.75rem;color:var(--muted);text-transform:uppercase;font-weight:600">' + type + '</span>';
  h += '</div></div>';

  if (item.desc) {
    let desc = item.desc.replace(/<[^>]*>/g, '').replace(/@[^@]+@/g, '?');
    h += '<p style="color:var(--muted);font-size:.9rem;line-height:1.6">' + desc + '</p>';
  }

  // Effects
  const efKeys = Object.keys(item.effects || {}).filter((k) => !/^\{[0-9a-f]+\}$/i.test(k));
  if (efKeys.length) {
    h += '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.75rem">';
    efKeys.forEach((k) => {
      const v = item.effects[k];
      const vStr = typeof v === 'number' && !Number.isInteger(v) && String(v).split('.')[1]?.length > 2 ? v.toFixed(2) : String(v);
      h += '<span style="font-size:.72rem;padding:.15rem .4rem;border-radius:6px;background:var(--surface-strong);color:var(--brand);font-weight:600;border:1px solid var(--border)">' + esc(k) + ': ' + esc(vStr) + '</span>';
    });
    h += '</div>';
  }

  // Recipe
  if (item.from && item.from.length) {
    h += '<div style="margin-top:1rem"><span style="font-size:.72rem;color:var(--muted);text-transform:uppercase;font-weight:700;letter-spacing:.04em">Recipe</span>';
    h += '<div style="display:flex;gap:.5rem;margin-top:.35rem">';
    item.from.forEach((compId) => {
      const comp = DATA.items?.find((i) => i.uniqueId === compId);
      if (comp) {
        h += '<div style="display:flex;align-items:center;gap:.3rem;padding:.25rem .5rem;border-radius:8px;background:var(--surface-strong);border:1px solid var(--border)">';
        if (comp.icon) h += '<img src="' + comp.icon + '" alt="" style="width:24px;height:24px;border-radius:4px" />';
        h += '<span style="font-size:.75rem;font-weight:600">' + esc(comp.name) + '</span></div>';
      }
    });
    h += '</div></div>';
  }

  det.innerHTML = h;
}

function closeItemModal() {
  const m = document.getElementById('itemModal');
  m.classList.add('hidden');
  m.setAttribute('aria-hidden', 'true');
}

// ── Player Search ──
function openPlayerModal(prefill) {
  const m = document.getElementById('playerModal');
  if (!m) return;
  m.classList.remove('hidden');
  const pi = document.getElementById('playerInput');
  if (pi && prefill) pi.value = prefill;
  if (pi) pi.focus();
}

function closePlayerModal() {
  const m = document.getElementById('playerModal');
  if (!m) return;
  m.classList.add('hidden');
  const rd = document.getElementById('playerSearchResults');
  const pd = document.getElementById('playerProfile');
  if (rd) rd.innerHTML = '';
  if (pd) { pd.innerHTML = ''; pd.classList.add('hidden'); }
}

function overviewSearch() {
  const inp = document.getElementById('ovSearch');
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  openPlayerModal(v);
}

// ── Event Binding ──
function bind() {
  // Navigation
  document.querySelectorAll('.nav-link').forEach((b) =>
    b.addEventListener('click', () => showSection(b.dataset.section))
  );

  // Quick links & overview stat cards
  document.querySelectorAll('.ql-card, .ov-stat').forEach((c) =>
    c.addEventListener('click', () => { if (c.dataset.section) showSection(c.dataset.section); })
  );

  // Champion search
  const cs = document.getElementById('champSearch');
  if (cs) cs.addEventListener('input', (e) => filterChampions(e.target.value));

  // Cost filters
  document.querySelectorAll('.cost-filter').forEach((b) =>
    b.addEventListener('click', () => filterByCost(b.dataset.cost))
  );

  // Champion card clicks
  document.querySelectorAll('.champ-card').forEach((c) =>
    c.addEventListener('click', () => { if (c.dataset.champId) showChampionDetails(c.dataset.champId); })
  );

  // Item search
  const is = document.getElementById('itemSearch');
  if (is) is.addEventListener('input', (e) => filterItems(e.target.value));

  // Item category filters
  document.querySelectorAll('.item-cat-filter').forEach((b) =>
    b.addEventListener('click', () => filterItemCategory(b.dataset.cat))
  );

  // Item card clicks
  document.querySelectorAll('.item-card').forEach((c) =>
    c.addEventListener('click', () => { if (c.dataset.itemId) showItemDetails(c.dataset.itemId); })
  );

  // Trait search
  const ts = document.getElementById('traitSearch');
  if (ts) ts.addEventListener('input', (e) => filterTraits(e.target.value));

  // Trait description click-to-expand (also toggles detail rows)
  document.querySelectorAll('.trait-desc').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('expanded');
      const card = el.closest('.trait-card');
      if (!card) return;
      const details = card.querySelector('.trait-details');
      if (!details) return;
      const show = el.classList.contains('expanded');
      details.style.display = show ? 'flex' : 'none';
      // Hide the summary breakpoint badges when details are visible
      const bp = card.querySelector('.trait-breakpoints');
      if (bp) bp.style.display = show ? 'none' : 'flex';
    });
  });

  // Trait champion clicks → open champion modal
  document.querySelectorAll('.trait-champ-entry').forEach((el) =>
    el.addEventListener('click', () => { if (el.dataset.champId) showChampionDetails(el.dataset.champId); })
  );

  // Trait "+N" expand buttons (one-way expand, no collapse)
  document.querySelectorAll('.trait-champ-more').forEach((btn) =>
    btn.addEventListener('click', () => {
      const overflow = btn.parentElement.querySelector('.trait-champ-overflow');
      if (!overflow) return;
      overflow.style.display = 'contents';
      btn.style.display = 'none';
    })
  );

  // Augment search
  const as = document.getElementById('augmentSearch');
  if (as) as.addEventListener('input', (e) => filterAugments(e.target.value));

  // Augment tier filters
  document.querySelectorAll('.aug-tier-filter').forEach((b) =>
    b.addEventListener('click', () => filterAugmentTier(b.dataset.tier))
  );

  // Overview search
  const oi = document.getElementById('ovSearch');
  if (oi) oi.addEventListener('keydown', (e) => { if (e.key === 'Enter') overviewSearch(); });
  const ob = document.getElementById('ovSearchBtn');
  if (ob) ob.addEventListener('click', overviewSearch);

  // Modal close
  const cb = document.getElementById('closeModalBtn');
  if (cb) cb.addEventListener('click', closeChampModal);
  const champModal = document.getElementById('champModal');
  if (champModal) champModal.addEventListener('click', (e) => { if (e.target === champModal) closeChampModal(); });

  const cib = document.getElementById('closeItemModalBtn');
  if (cib) cib.addEventListener('click', closeItemModal);
  const itemModal = document.getElementById('itemModal');
  if (itemModal) itemModal.addEventListener('click', (e) => { if (e.target === itemModal) closeItemModal(); });

  const pmc = document.getElementById('playerModalClose');
  if (pmc) pmc.addEventListener('click', closePlayerModal);
  const pm = document.getElementById('playerModal');
  if (pm) pm.addEventListener('click', (e) => { if (e.target === pm) closePlayerModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeChampModal(); closeItemModal(); closePlayerModal(); }
  });

  // Theme toggle
  const tt = document.getElementById('themeToggle');
  if (tt) tt.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // Product switcher
  const psBtn = document.getElementById('productSwitcherBtn');
  const psDrop = document.getElementById('productSwitcherDropdown');
  if (psBtn && psDrop) {
    psBtn.addEventListener('click', (e) => { e.stopPropagation(); psDrop.classList.toggle('hidden'); });
    document.addEventListener('click', (e) => { if (!psDrop.contains(e.target) && e.target !== psBtn) psDrop.classList.add('hidden'); });
  }

  // Header search bar
  const hsb = document.getElementById('headerSearchBtn');
  const hsi = document.getElementById('headerSearchInput');
  const hsd = document.getElementById('headerSearch');
  if (hsb) hsb.addEventListener('click', () => {
    if (!hsd.classList.contains('open')) { hsd.classList.add('open'); hsi.focus(); return; }
    const v = hsi ? hsi.value.trim() : '';
    if (v) openPlayerModal(v);
  });
  if (hsi) hsi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = hsi.value.trim(); if (v) openPlayerModal(v); }
    if (e.key === 'Escape') { hsd.classList.remove('open'); hsi.value = ''; }
  });

  // Leaderboard region buttons
  document.querySelectorAll('.region-btn').forEach((b) =>
    b.addEventListener('click', () => {
      state.lbRegion = b.dataset.region;
      document.querySelectorAll('.region-btn').forEach((r) => r.classList.toggle('active', r.dataset.region === state.lbRegion));
      document.getElementById('lbStatus').textContent = 'Region: ' + state.lbRegion.toUpperCase() + ' — Connect Riot API to load data.';
    })
  );

  // Leaderboard tier tabs
  document.querySelectorAll('.lb-tier-tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.lbTier = b.dataset.tier;
      document.querySelectorAll('.lb-tier-tab').forEach((t) => t.classList.toggle('active', t.dataset.tier === state.lbTier));
      document.getElementById('lbStatus').textContent = state.lbTier.charAt(0).toUpperCase() + state.lbTier.slice(1) + ' — ' + state.lbRegion.toUpperCase() + ' — Connect Riot API to load data.';
    })
  );
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);
  initTheme();
  bind();
  showSection('overview');
});

window.Scouted = { showChampionDetails, closeChampModal, showItemDetails, closeItemModal, openPlayerModal, closePlayerModal, overviewSearch };
