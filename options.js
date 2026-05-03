/**
 * options.js — Settings page controller (Phase 4: + Pin Templates editor).
 */

'use strict';

const DEFAULTS = {
  associateTag:           '',
  defaultBoard:           'Amazon Finds',
  defaultCategory:        '',
  defaultDisclosure:      '#ad As an Amazon Associate, I earn from qualifying purchases.',
  defaultPriceDisclaimer: 'Prices, deals, and coupon codes may change or end at any time.',
  hoverButtonsEnabled:    false,
  facebookOnlyMode:       true,
  qualityWarningsEnabled: true,
};

const KEYS = Object.keys(DEFAULTS);

// Phase 4 — categories shown in the templates editor. Mirrors
// TEMPLATE_CATEGORIES exposed by utils/templates.js.
const TEMPLATE_TABS = [
  { key: 'tech',              label: 'Tech' },
  { key: 'home-organization', label: 'Home Organization' },
  { key: 'kitchen',           label: 'Kitchen' },
  { key: 'beauty',            label: 'Beauty / Self-Care' },
  { key: 'fashion',           label: 'Fashion' },
  { key: 'office',            label: 'Office' },
  { key: 'art',               label: 'Art' },
  { key: 'eco',               label: 'Eco' },
  { key: 'default',           label: 'Default' },
];

// In-memory copy of the currently-edited templates map.
let templatesState = {};

// ─── Load ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(KEYS);
  const s = { ...DEFAULTS, ...data };

  document.getElementById('associate-tag').value             = s.associateTag;
  document.getElementById('default-board').value             = s.defaultBoard;
  document.getElementById('default-category').value          = s.defaultCategory;
  document.getElementById('default-disclosure').value        = s.defaultDisclosure;
  document.getElementById('default-price-disclaimer').value  = s.defaultPriceDisclaimer;
  document.getElementById('hover-buttons').checked           = s.hoverButtonsEnabled;
  document.getElementById('fb-only-mode').checked            = s.facebookOnlyMode;
  document.getElementById('quality-warnings').checked        = s.qualityWarningsEnabled !== false;
}

// ─── Save ──────────────────────────────────────────────────────────────────

async function saveSettings(e) {
  e.preventDefault();

  const associateTag = document.getElementById('associate-tag').value.trim();
  if (!associateTag) {
    showStatus('Amazon Associate tag is required.', 'error');
    return;
  }

  const settings = {
    associateTag,
    defaultBoard:           document.getElementById('default-board').value.trim() || DEFAULTS.defaultBoard,
    defaultCategory:        document.getElementById('default-category').value,
    defaultDisclosure:      document.getElementById('default-disclosure').value.trim() || DEFAULTS.defaultDisclosure,
    defaultPriceDisclaimer: document.getElementById('default-price-disclaimer').value.trim() || DEFAULTS.defaultPriceDisclaimer,
    hoverButtonsEnabled:    document.getElementById('hover-buttons').checked,
    facebookOnlyMode:       document.getElementById('fb-only-mode').checked,
    qualityWarningsEnabled: document.getElementById('quality-warnings').checked,
  };

  await chrome.storage.local.set(settings);

  // Notify active Facebook tabs to toggle hover buttons
  const tabs = await chrome.tabs.query({ url: ['https://facebook.com/*', 'https://www.facebook.com/*', 'https://m.facebook.com/*'] });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { action: 'setHoverButtons', enabled: settings.hoverButtonsEnabled }).catch(() => {});
  });

  showStatus('Settings saved.', 'success');
}

// ─── Reset ─────────────────────────────────────────────────────────────────

async function resetSettings() {
  if (!confirm('Reset all settings to defaults?')) return;
  await chrome.storage.local.set(DEFAULTS);
  await loadSettings();
  showStatus('Settings reset to defaults.', 'success');
}

// ─── Phase 4: Templates editor ─────────────────────────────────────────────

function renderTemplateTabs(activeKey) {
  const container = document.getElementById('templates-tabs');
  if (!container) return;
  container.innerHTML = '';
  for (const t of TEMPLATE_TABS) {
    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'opts-templates-tab' + (t.key === activeKey ? ' active' : '');
    btn.textContent = t.label;
    btn.dataset.cat = t.key;
    btn.addEventListener('click', () => {
      // Save in-progress edits for the current tab into templatesState
      stashCurrentEditorIntoState();
      // Switch to the new tab and repopulate the form fields.
      document.getElementById('tpl-active-category').value = t.key;
      renderTemplateTabs(t.key);
      populateEditorFromState(t.key);
    });
    container.appendChild(btn);
  }
}

function populateEditorFromState(cat) {
  const t = (templatesState && templatesState[cat]) || {};
  document.getElementById('tpl-suggested-board').value  = t.suggestedBoard  || '';
  document.getElementById('tpl-tagged-topics').value    = (t.taggedTopics || []).join(', ');
  document.getElementById('tpl-hashtags').value         = (t.hashtags     || []).join(' ');
  document.getElementById('tpl-disclosure').value       = t.disclosureText || '';
  document.getElementById('tpl-deal-disclaimer').value  = t.dealDisclaimer || '';
}

function stashCurrentEditorIntoState() {
  const cat = document.getElementById('tpl-active-category').value || 'default';
  const taggedTopicsRaw = document.getElementById('tpl-tagged-topics').value;
  const hashtagsRaw     = document.getElementById('tpl-hashtags').value;

  const taggedTopics = taggedTopicsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const hashtags     = hashtagsRaw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
                                   .map(s => s.startsWith('#') ? s : '#' + s);

  templatesState[cat] = {
    ...(templatesState[cat] || {}),
    category:       cat,
    suggestedBoard: document.getElementById('tpl-suggested-board').value.trim(),
    taggedTopics,
    hashtags,
    disclosureText: document.getElementById('tpl-disclosure').value.trim(),
    dealDisclaimer: document.getElementById('tpl-deal-disclaimer').value.trim(),
  };
}

async function loadTemplates() {
  try {
    if (typeof getSavedTemplates !== 'function') {
      console.warn('[AffiliatePin] templates module not loaded');
      templatesState = {};
      return;
    }
    templatesState = await getSavedTemplates();
  } catch (e) {
    console.warn('[AffiliatePin] templates load failed:', e);
    templatesState = (typeof getDefaultTemplates === 'function') ? getDefaultTemplates() : {};
  }
  const initialCat = (TEMPLATE_TABS[0] && TEMPLATE_TABS[0].key) || 'default';
  document.getElementById('tpl-active-category').value = initialCat;
  renderTemplateTabs(initialCat);
  populateEditorFromState(initialCat);
}

async function saveTemplatesFromEditor() {
  stashCurrentEditorIntoState();
  if (typeof saveTemplates !== 'function') {
    showStatus('Templates module is unavailable.', 'error');
    return;
  }
  const saved = await saveTemplates(templatesState);
  templatesState = saved;
  // Repopulate so any normalisation (de-dupe, # prefix) shows up.
  populateEditorFromState(document.getElementById('tpl-active-category').value || 'default');
  showStatus('Pin templates saved.', 'success');
}

async function resetTemplatesFromEditor() {
  if (!confirm('Reset all pin templates to defaults? Your custom edits will be lost.')) return;
  if (typeof resetTemplates !== 'function') {
    showStatus('Templates module is unavailable.', 'error');
    return;
  }
  templatesState = await resetTemplates();
  populateEditorFromState(document.getElementById('tpl-active-category').value || 'default');
  showStatus('Pin templates reset to defaults.', 'success');
}

// ─── Status Banner ─────────────────────────────────────────────────────────

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className   = `opts-status ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ─── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadTemplates();
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('btn-reset').addEventListener('click', resetSettings);

  const btnTplSave  = document.getElementById('btn-templates-save');
  const btnTplReset = document.getElementById('btn-templates-reset');
  if (btnTplSave)  btnTplSave .addEventListener('click', saveTemplatesFromEditor);
  if (btnTplReset) btnTplReset.addEventListener('click', resetTemplatesFromEditor);
});
