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
  h += '<div class="cd-stats-grid">';
  h += statCard('HP', s.hp[0] + ' / ' + s.hp[1] + ' / ' + s.hp[2]);
  h += statCard('Mana', s.initialMana + ' / ' + s.mana);
  h += statCard('Damage', s.damage[0] + ' / ' + s.damage[1] + ' / ' + s.damage[2]);
  h += statCard('Atk Spd', s.attackSpeed.toFixed(2));
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
      // Clean TFT ability desc placeholders like @AbilityValue@
      desc = desc.replace(/@[^@]+@/g, '?');
      // strip inline html tags for safety
      desc = desc.replace(/<[^>]*>/g, '');
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
  const efKeys = Object.keys(item.effects || {});
  if (efKeys.length) {
    h += '<div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.75rem">';
    efKeys.forEach((k) => {
      h += '<span style="font-size:.72rem;padding:.15rem .4rem;border-radius:6px;background:var(--surface-strong);color:var(--brand);font-weight:600;border:1px solid var(--border)">' + esc(k) + ': ' + esc(String(item.effects[k])) + '</span>';
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
