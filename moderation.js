'use strict';
const db = require('./db');

// ── Compteurs flood en mémoire ────────────────────────────────
// { phone: { count, firstTs, lastWarned } }
const floodMap = new Map();

const FLOOD_LIMIT = 8;          // messages max en FLOOD_WINDOW
const FLOOD_WINDOW_MS = 10_000; // fenêtre de 10 secondes
const WARN_COOLDOWN_MS = 60_000;// 1 min entre deux avertissements flood

// ── Liens / patterns suspects ─────────────────────────────────
const LINK_PATTERNS = [
  /https?:\/\//i,
  /wa\.me\//i,
  /chat\.whatsapp\.com\//i,
  /t\.me\//i,
  /bit\.ly\//i,
  /tinyurl\.com\//i,
];

const SPAM_KEYWORDS = [
  /rejoins?\s+ce\s+groupe/i,
  /clique\s+ici/i,
  /gagner\s+de\s+l.argent/i,
  /100%\s+gratuit/i,
  /recrutement\s+urgent/i,
];

// ── Point d'entrée principal ──────────────────────────────────
async function checkMessage(msg, phone, groupJid, sendFn) {
  const body = msg.body || '';
  const now = Date.now();

  // 1. Vérifier flood
  const floodResult = checkFlood(phone, now);
  if (floodResult === 'WARN') {
    await logModeration(phone, groupJid, 'flood_warning', 'avertissement', 'Flood détecté — trop de messages rapides');
    await sendFn(`⚠️ @${phone.slice(-4)} — Tu envoies trop vite ! Calme-toi pour éviter une restriction.`);
    return false;
  }
  if (floodResult === 'BLOCK') {
    // Bloquer silencieusement, déjà averti
    return false;
  }

  // 2. Vérifier liens
  const hasLink = LINK_PATTERNS.some(p => p.test(body));
  if (hasLink) {
    await logModeration(phone, groupJid, 'link_detected', 'information', `Lien détecté dans le message`);
    // Lien → pas de XP, mais on ne supprime pas (whatsapp-web.js ne peut pas supprimer dans tous les cas)
    // On retourne false pour bloquer l'XP uniquement
    return false;
  }

  // 3. Vérifier spam keywords
  const hasSpam = SPAM_KEYWORDS.some(p => p.test(body));
  if (hasSpam) {
    await logModeration(phone, groupJid, 'spam_detected', 'infraction', `Pattern spam détecté`);
    await sendFn(`⚠️ Message suspect détecté. L'équipe de modération a été notifiée.`);
    return false;
  }

  // 4. Ignorer messages trop courts (< 2 chars) ou qui sont des commandes
  if (body.length < 2 || body.startsWith('/')) return false;

  return true; // Message valide → XP accordé
}

function checkFlood(phone, now) {
  if (!floodMap.has(phone)) {
    floodMap.set(phone, { count: 1, firstTs: now, lastWarned: 0 });
    return 'OK';
  }

  const entry = floodMap.get(phone);

  // Réinitialiser la fenêtre si expirée
  if (now - entry.firstTs > FLOOD_WINDOW_MS) {
    floodMap.set(phone, { count: 1, firstTs: now, lastWarned: entry.lastWarned });
    return 'OK';
  }

  entry.count++;

  if (entry.count > FLOOD_LIMIT * 2) return 'BLOCK';

  if (entry.count > FLOOD_LIMIT) {
    if (now - entry.lastWarned > WARN_COOLDOWN_MS) {
      entry.lastWarned = now;
      return 'WARN';
    }
    return 'BLOCK';
  }

  return 'OK';
}

// Nettoyer les entrées flood expirées toutes les 5 min
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of floodMap.entries()) {
    if (now - entry.firstTs > FLOOD_WINDOW_MS * 10) floodMap.delete(phone);
  }
}, 5 * 60_000);

// ── Logger une action de modération ──────────────────────────
async function logModeration(phone, groupJid, action, level, reason) {
  try {
    const member = await db.getMemberByPhone(phone);
    if (!member) return;
    await db.query(
      `INSERT INTO moderation_log (member_id, group_jid, action, level, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [member.id, groupJid, action, level, reason]
    );
  } catch (err) {
    console.error('[MOD LOG ERROR]', err.message);
  }
}

module.exports = { checkMessage };
