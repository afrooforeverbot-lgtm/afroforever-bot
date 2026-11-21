'use strict';
require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const config = require('./config');
const db = require('./db');
const server = require('./server');
const { handleRegistration } = require('./registration');
const { routeCommand } = require('./commands/index');
const { checkMessage } = require('./moderation');

// ── État global en mémoire (caches) ──────────────────────────
let authorizedGroups = new Map(); // groupJid → row
let adminPhones = new Set();       // numéros admin
const xpPending = new Map();       // phone → xp à flush

// ── Démarrage du serveur HTTP ─────────────────────────────────
server.start();

// ── Initialisation du client WhatsApp ────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

// ── QR Code ───────────────────────────────────────────────────
client.on('qr', (qr) => {
  console.log('[QR] Nouveau QR code généré — ouvre http://localhost:' + config.PORT);
  server.setQR(qr);
});

// ── Authentifié ───────────────────────────────────────────────
client.on('authenticated', () => {
  console.log('[AUTH] Session WhatsApp authentifiée.');
});

// ── Prêt ──────────────────────────────────────────────────────
client.on('ready', async () => {
  const info = client.info;
  const botNumber = info?.wid?.user || 'inconnu';
  console.log(`[READY] Bot connecté — numéro : ${botNumber}`);
  server.setReady(botNumber);

  // Charger les caches depuis la base
  try {
    authorizedGroups = await db.loadAuthorizedGroups();
    adminPhones = await db.loadBotAdmins();
    const sysConfigRows = await db.loadSysConfig();
    config.setSysConfig(sysConfigRows);
    console.log(`[BOOT] ${authorizedGroups.size} groupe(s) actif(s) | ${adminPhones.size} admin(s) chargé(s)`);
  } catch (err) {
    console.error('[BOOT] Erreur chargement caches :', err.message);
  }

  // Rafraîchissement du cache toutes les CACHE_TTL_MS
  setInterval(async () => {
    try {
      authorizedGroups = await db.loadAuthorizedGroups();
      adminPhones = await db.loadBotAdmins();
      const sysConfigRows = await db.loadSysConfig();
      config.setSysConfig(sysConfigRows);
      console.log('[CACHE] Caches rafraîchis');
    } catch (err) {
      console.error('[CACHE ERROR]', err.message);
    }
  }, config.get('CACHE_TTL_MS'));

  // Flush XP périodique
  setInterval(async () => {
    try {
      await db.flushXPBatch(xpPending);
    } catch (err) {
      console.error('[XP FLUSH ERROR]', err.message);
    }
  }, config.get('XP_FLUSH_INTERVAL_MS'));

  // Drain XP programmé (si activé)
  startDrainCron();
});

// ── Déconnexion ───────────────────────────────────────────────
client.on('disconnected', (reason) => {
  console.warn(`[DISCONNECTED] Raison : ${reason}`);
  server.setReady(null);
  setTimeout(() => {
    console.log('[RECONNECT] Tentative de reconnexion…');
    client.initialize().catch(err => console.error('[RECONNECT ERROR]', err.message));
  }, config.get('RECONNECT_DELAY_MS'));
});

// ── Réception de message ──────────────────────────────────────
client.on('message_create', async (msg) => {
  try {
    // Ignorer messages du bot lui-même (fromMe dans les groupes)
    if (msg.fromMe) return;

    // Extraire le numéro de l'auteur
    const rawAuthor = msg.author || msg.from || '';
    const phone = rawAuthor.replace('@c.us', '').replace(/[^0-9]/g, '');
    if (!phone) return;

    const isGroup = msg.from?.endsWith('@g.us');
    const groupJid = isGroup ? msg.from : null;

    console.log(`[INCOMING] from:${phone} | group:${groupJid || 'MP'} | body:"${(msg.body || '').substring(0, 40)}"`);

    // ── Fonction d'envoi contextuelle ──────────────────────────
    const sendFn = async (text) => {
      try {
        await msg.reply(text);
      } catch {
        const chat = await msg.getChat();
        await chat.sendMessage(text);
      }
    };

    // ── Charger le membre ─────────────────────────────────────
    let member = await db.getMemberByPhone(phone);

    // ── Commandes /start ou Rejoindre (hors groupe ou dans groupe) ─
    const bodyLower = (msg.body || '').trim().toLowerCase();
    const isStartCmd = ['/start', '/rejoindre', 'rejoindre', '/inscription'].includes(bodyLower);

    if (isStartCmd) {
      if (!member) {
        member = await db.createMember(phone);
        if (!member) {
          await sendFn('❌ Erreur lors de la création de ton compte. Réessaie dans quelques instants.');
          return;
        }
      }
      if (member.registration_step === 'done') {
        await sendFn(`Tu es déjà inscrit ! Tape */profil* pour voir ton profil Afro'o Forever.`);
        return;
      }
      await handleRegistration(msg, member, sendFn);
      return;
    }

    // ── Inscription en cours (réponse aux étapes) ─────────────
    if (member && member.registration_step !== 'done') {
      await handleRegistration(msg, member, sendFn);
      return;
    }

    // ── Confirmation de montée de grade (OUI/NON) ─────────────
    if (member && member.registration_step === 'done') {
      const data = member.registration_data || {};
      if (data.pending_grade_upgrade && ['oui', 'non'].includes(bodyLower)) {
        const { cmdConfirmGrade } = require('./commands/public');
        await cmdConfirmGrade(msg, member, sendFn);
        return;
      }
    }

    // ── Messages dans les groupes ─────────────────────────────
    if (isGroup) {
      // Groupe non autorisé : seul /activer-groupe passe
      if (!authorizedGroups.has(groupJid)) {
        const isSuperAdmin = config.SUPER_ADMIN_NUMBERS.includes(phone);
        if (isSuperAdmin && bodyLower === '/activer-groupe') {
          const sup = require('./commands/superadmin');
          await sup.cmdActiverGroupe(msg, authorizedGroups, sendFn);
        }
        return;
      }

      // Membre banni → ignorer
      if (member?.status === 'banned') return;

      // ── Commandes ─────────────────────────────────────────
      if ((msg.body || '').startsWith('/') || (msg.body || '').startsWith('!')) {
        if (!member) {
          await sendFn(`👋 Bienvenue ! Tape */start* pour rejoindre Afro'o Forever.`);
          return;
        }
        await routeCommand(msg, member, authorizedGroups, adminPhones, sendFn);
        return;
      }

      // ── XP automatique ────────────────────────────────────
      if (!member || member.registration_step !== 'done') {
        // Pas encore inscrit — suggérer l'inscription une fois toutes les X messages
        // (éviter le flood de suggestions)
        return;
      }

      const isValid = await checkMessage(msg, phone, groupJid, sendFn);
      if (isValid) {
        const current = xpPending.get(phone) || 0;
        xpPending.set(phone, current + config.get('XP_PER_MESSAGE'));
      }
      return;
    }

    // ── Messages privés (hors groupe) ────────────────────────
    // Les MP servent principalement à l'inscription et aux commandes perso
    if (!member) {
      await sendFn(
        `🌍 *Bienvenue dans l'Empire Afro'o Forever !*\n\n` +
        `Tape */start* pour commencer ton inscription.`
      );
      return;
    }

    if (member.registration_step !== 'done') {
      await handleRegistration(msg, member, sendFn);
      return;
    }

    // Commandes en MP
    if ((msg.body || '').startsWith('/')) {
      await routeCommand(msg, member, authorizedGroups, adminPhones, sendFn);
    }

  } catch (err) {
    console.error('[MESSAGE ERROR]', err.message, err.stack);
  }
});

// ── Drain XP avec node-cron ───────────────────────────────────
function startDrainCron() {
  try {
    const cron = require('node-cron');
    const cronExpr = '0 0 * * 0'; // Dimanche minuit par défaut

    cron.schedule(cronExpr, async () => {
      if (!config.get('XP_DRAIN_ENABLED')) return;
      const amount = config.get('XP_DRAIN_AMOUNT') || 100;
      const grace = config.get('XP_DRAIN_GRACE_DAYS') || 30;

      console.log(`[DRAIN] Démarrage drain XP (${amount} XP par membre inactif)…`);
      try {
        const res = await db.query(
          `UPDATE members SET xp_current = GREATEST(0, xp_current - $1), updated_at=now()
           WHERE status='active'
           AND registration_step='done'
           AND created_at < NOW() - INTERVAL '${grace} days'`,
          [amount]
        );
        console.log(`[DRAIN] ${res.rowCount} membres drainés de ${amount} XP`);

        // Notification dans le groupe dédié si configuré
        const notifJid = config.get('NOTIFICATION_GROUP_JID');
        if (notifJid) {
          const chat = await client.getChatById(notifJid);
          if (chat) {
            await chat.sendMessage(
              `⚡ *Drain XP hebdomadaire effectué*\n` +
              `${res.rowCount} membres ont perdu ${amount} XP d'inactivité.\n` +
              `_Reste actif pour maintenir ton rang !_`
            );
          }
        }
      } catch (err) {
        console.error('[DRAIN ERROR]', err.message);
      }
    });

    console.log('[CRON] Drain XP programmé');
  } catch (err) {
    console.error('[CRON ERROR]', err.message);
  }
}

// ── Arrêt propre ──────────────────────────────────────────────
async function shutdown() {
  console.log('[SHUTDOWN] Arrêt en cours…');
  try {
    await db.flushXPBatch(xpPending);
    await db.close();
    await client.destroy();
  } catch {}
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ── Lancement ─────────────────────────────────────────────────
console.log('[BOOT] Démarrage Afro\'o Forever Bot…');
console.log(`[BOOT] Super-admins : ${config.SUPER_ADMIN_NUMBERS.join(', ') || '⚠️ AUCUN DÉFINI'}`);

client.initialize().catch(err => {
  console.error('[INIT ERROR]', err.message);
  process.exit(1);
});
