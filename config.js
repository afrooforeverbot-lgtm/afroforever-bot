'use strict';
require('dotenv').config();

// ── Super-admins depuis la variable d'environnement ──────────
const SUPER_ADMIN_NUMBERS = (process.env.SUPER_ADMIN_NUMBERS || '')
  .split(',')
  .map(n => n.trim())
  .filter(Boolean);

// ── Configuration par défaut (écrasée par system_config en DB) ──
const DEFAULTS = {
  XP_PER_MESSAGE: 1,
  XP_FLUSH_INTERVAL_MS: 60_000,
  XP_DRAIN_ENABLED: false,
  XP_DRAIN_AMOUNT: 100,
  XP_DRAIN_GRACE_DAYS: 30,
  CACHE_TTL_MS: 60_000,
  RECONNECT_DELAY_MS: 15_000,
  MAX_GROUPS: 20,
};

// Cache des configs système chargées depuis la DB
let _sysConfig = { ...DEFAULTS };

function setSysConfig(dbRows) {
  for (const row of dbRows) {
    const k = row.key.toUpperCase();
    const v = row.value;
    if (k === 'XP_PER_MESSAGE') _sysConfig.XP_PER_MESSAGE = parseInt(v) || 1;
    if (k === 'XP_FLUSH_INTERVAL_MS') _sysConfig.XP_FLUSH_INTERVAL_MS = parseInt(v) || 60000;
    if (k === 'XP_DRAIN_ENABLED') _sysConfig.XP_DRAIN_ENABLED = v === 'true';
    if (k === 'XP_DRAIN_AMOUNT') _sysConfig.XP_DRAIN_AMOUNT = parseInt(v) || 100;
    if (k === 'XP_DRAIN_GRACE_DAYS') _sysConfig.XP_DRAIN_GRACE_DAYS = parseInt(v) || 30;
    if (k === 'CACHE_TTL_MS') _sysConfig.CACHE_TTL_MS = parseInt(v) || 60000;
    if (k === 'RECONNECT_DELAY_MS') _sysConfig.RECONNECT_DELAY_MS = parseInt(v) || 15000;
    if (k === 'MAX_GROUPS_PER_BOT') _sysConfig.MAX_GROUPS = parseInt(v) || 20;
    if (k === 'NOTIFICATION_GROUP_JID') _sysConfig.NOTIFICATION_GROUP_JID = v;
    if (k === 'AFROO_XP_RATE') _sysConfig.AFROO_XP_RATE = parseInt(v) || 100;
    if (k === 'CONSENT_VERSION') _sysConfig.CONSENT_VERSION = v;
  }
}

function get(key) {
  return _sysConfig[key] ?? DEFAULTS[key];
}

module.exports = {
  SUPER_ADMIN_NUMBERS,
  DEFAULTS,
  setSysConfig,
  get,
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: parseInt(process.env.PORT) || 8080,
};
