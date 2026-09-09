'use strict';
const { SUPER_ADMIN_NUMBERS } = require('../config');
const pub = require('./public');
const adm = require('./admin');
const sup = require('./superadmin');

// ── Routeur principal ─────────────────────────────────────────
async function routeCommand(msg, member, authorizedGroups, adminPhones, sendFn) {
  const body = (msg.body || '').trim();
  const cmd = body.split(/\s+/)[0].toLowerCase();
  const phone = (msg.author || msg.from || '').replace('@c.us', '').replace(/[^0-9]/g, '');

  const isSuperAdmin = SUPER_ADMIN_NUMBERS.includes(phone);
  const isAdmin = isSuperAdmin || adminPhones.has(phone);

  console.log(`[CMD] ${cmd} | from:${phone} | superAdmin:${isSuperAdmin} | admin:${isAdmin}`);

  // ── Commandes publiques ─────────────────────────────────────
  if (!member || member.registration_step !== 'done') {
    // Avant inscription, seulement /start et /id
    if (['/start', '/rejoindre', 'rejoindre', '/inscription'].includes(cmd)) return null; // géré dans bot.js
    if (cmd === '/id' && isSuperAdmin) return sup.cmdId(msg, sendFn);
    if (body.toLowerCase().startsWith('j\'accepte') || body.toLowerCase() === 'jaccepte') return null;
    return; // ignorer
  }

  switch (cmd) {
    // ── Profil & stats ────────────────────────────────────────
    case '/profil':
    case '/profile':
      return pub.cmdProfil(msg, member, sendFn);

    case '/xp':
      return pub.cmdXp(msg, member, sendFn);

    case '/stats':
      return pub.cmdStats(msg, member, sendFn);

    // ── Classement ───────────────────────────────────────────
    case '/classement':
    case '/top':
    case '/ranking':
      return pub.cmdClassement(msg, member, sendFn);

    // ── Grade ────────────────────────────────────────────────
    case '/grade':
      return pub.cmdGrade(msg, member, sendFn);

    case '/monter-grade':
    case '/upgrade':
      return pub.cmdMonterGrade(msg, member, sendFn);

    // ── Badges ───────────────────────────────────────────────
    case '/badges':
    case '/badge':
      // Si admin + mention → attribution de badge
      if (isAdmin && msg.mentionedIds?.length > 0) {
        return adm.cmdBadge(msg, member, sendFn);
      }
      return pub.cmdBadges(msg, member, sendFn);

    // ── Missions ─────────────────────────────────────────────
    case '/missions':
    case '/quetes':
      return pub.cmdMissions(msg, member, sendFn);

    // ── Afroo ────────────────────────────────────────────────
    case '/afroo':
    case '/monnaie':
      return pub.cmdAfroo(msg, member, sendFn);

    // ── Aide ─────────────────────────────────────────────────
    case '/aide':
    case '/help':
      return cmdHelp(isAdmin, isSuperAdmin, sendFn);

    // ── Commandes ADMIN ──────────────────────────────────────
    case '/addxp':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdAddXp(msg, member, sendFn);

    case '/removexp':
    case '/removexp':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdRemoveXp(msg, member, sendFn);

    case '/setgrade':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdSetGrade(msg, member, sendFn);

    case '/settype':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdSetType(msg, member, sendFn);

    case '/warn':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdWarn(msg, member, sendFn);

    case '/info-membre':
    case '/info':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdInfoMembre(msg, member, sendFn);

    case '/afroo-give':
      if (!isAdmin) return sendFn('❌ Commande réservée aux admins.');
      return adm.cmdAfrooGive(msg, member, sendFn);

    // ── Commandes SUPER-ADMIN ────────────────────────────────
    case '/activer-groupe':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdActiverGroupe(msg, authorizedGroups, sendFn);

    case '/desactiver-groupe':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdDesactiverGroupe(msg, authorizedGroups, sendFn);

    case '/add-admin':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdAddAdmin(msg, adminPhones, sendFn);

    case '/remove-admin':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdRemoveAdmin(msg, adminPhones, sendFn);

    case '/ban':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdBan(msg, sendFn);

    case '/unban':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdUnban(msg, sendFn);

    case '/change-numero':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdChangeNumero(msg, sendFn);

    case '/set-notif-groupe':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdSetNotifGroupe(msg, sendFn);

    case '/drain-xp':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdDrainXp(msg, sendFn);

    case '/id':
      if (!isSuperAdmin) return;
      return sup.cmdId(msg, sendFn);

    case '/groupes':
      if (!isSuperAdmin) return sendFn('❌ Commande réservée aux super-admins.');
      return sup.cmdGroupes(sendFn);

    default:
      // Commande inconnue — silence ou réponse minimaliste
      if (body.startsWith('/')) {
        await sendFn(`❓ Commande inconnue : *${cmd}*\nTape */aide* pour voir les commandes disponibles.`);
      }
  }
}

// ── /aide ─────────────────────────────────────────────────────
async function cmdHelp(isAdmin, isSuperAdmin, sendFn) {
  let msg =
    `📖 *Commandes Afro'o Forever*\n\n` +
    `━━ MEMBRES ━━\n` +
    `/profil — Ton profil complet\n` +
    `/xp — Ton XP et niveau\n` +
    `/grade — Ton grade actuel\n` +
    `/monter-grade — Convertir XP en grade\n` +
    `/badges — Tes badges\n` +
    `/missions — Missions en cours\n` +
    `/afroo — Solde Afroo\n` +
    `/classement — Top 20 membres\n` +
    `/classement clubs|légions|royaumes\n` +
    `/stats — Statistiques globales\n`;

  if (isAdmin) {
    msg +=
      `\n━━ ADMIN ━━\n` +
      `/addxp @m <n> — Ajouter XP\n` +
      `/removexp @m <n> — Retirer XP\n` +
      `/badge @m <nom> — Attribuer badge\n` +
      `/setgrade @m <rang> — Forcer grade\n` +
      `/settype @m <type> <⭐> — Attribuer type\n` +
      `/warn @m <raison> — Avertissement\n` +
      `/info-membre @m — Fiche technique\n` +
      `/afroo-give @m <n> — Donner Afroo\n`;
  }

  if (isSuperAdmin) {
    msg +=
      `\n━━ SUPER-ADMIN ━━\n` +
      `/activer-groupe — Activer ce groupe\n` +
      `/desactiver-groupe — Désactiver\n` +
      `/add-admin @m — Ajouter admin\n` +
      `/remove-admin @m — Retirer admin\n` +
      `/ban @m <raison> — Bannir\n` +
      `/unban @m — Lever bannissement\n` +
      `/change-numero @ancien @nouveau\n` +
      `/set-notif-groupe — Groupe notifs\n` +
      `/drain-xp — Test drain manuel\n` +
      `/groupes — Liste des groupes\n` +
      `/id — JID du groupe\n`;
  }

  await sendFn(msg);
}

module.exports = { routeCommand };
