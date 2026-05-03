/**
 * options.js — Settings page controller
 */

'use strict';

const DEFAULTS = {
  associateTag:         '',
  defaultBoard:         'Amazon Finds',
  defaultCategory:      '',
  defaultDisclosure:    '#ad As an Amazon Associate, I earn from qualifying purchases.',
  defaultPriceDisclaimer: 'Prices, deals, and coupon codes may change or end at any time.',
  hoverButtonsEnabled:  false,
  facebookOnlyMode:     true,
};

const KEYS = Object.keys(DEFAULTS);

// ─── Load ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const data = await chrome.storage.local.get(KEYS);
  const s = { ...DEFAULTS, ...data };

  document.getElementById('associate-tag').value           = s.associateTag;
  document.getElementById('default-board').value          = s.defaultBoard;
  document.getElementById('default-category').value       = s.defaultCategory;
  document.getElementById('default-disclosure').value     = s.defaultDisclosure;
  document.getElementById('default-price-disclaimer').value = s.defaultPriceDisclaimer;
  document.getElementById('hover-buttons').checked        = s.hoverButtonsEnabled;
  document.getElementById('fb-only-mode').checked         = s.facebookOnlyMode;
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
  document.getElementById('settings-form').addEventListener('submit', saveSettings);
  document.getElementById('btn-reset').addEventListener('click', resetSettings);
});
