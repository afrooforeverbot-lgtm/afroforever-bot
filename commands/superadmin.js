'use strict';
const db = require('../db');

// ── /activer-groupe ───────────────────────────────────────────
async function cmdActiverGroupe(msg, authorizedGroups, sendFn) {
  const groupJid = msg.from;
  const chat = await msg.getChat();
  const groupName = chat?.name || 'Groupe inconnu';

  if (authorizedGroups.has(groupJid)) {
    await sendFn(`✅ Ce groupe est déjà activé : *${groupName}*`);
    return;
  }

  await db.query(
    `INSERT INTO whatsapp_groups (group_jid, group_name, activated_by, status)
     VALUES ($1,$2,$3,'active')
     ON CONFLICT (group_jid) DO UPDATE SET status='active', group_name=$2, last_sync=now()`,
    [groupJid, groupName, msg.author || msg.from]
  );

  authorizedGroups.set(groupJid, { group_jid: groupJid, group_name: groupName, features_enabled: { xp: true, commands: true, moderation: true } });

  await sendFn(
    `✅ *Groupe Afro'o Forever activé !*\n\n` +
    `📛 Nom : *${groupName}*\n` +
    `🆔 JID : \`${groupJid}\`\n\n` +
    `Le bot suit maintenant l'XP et les commandes dans ce groupe.`
  );
  console.log(`[SUPERADMIN] Groupe activé : ${groupJid} (${groupName})`);
}

// ── /desactiver-groupe ────────────────────────────────────────
async function cmdDesactiverGroupe(msg, authorizedGroups, sendFn) {
  const groupJid = msg.from;

  await db.query(
    `UPDATE whatsapp_groups SET status='inactive' WHERE group_jid=$1`,
    [groupJid]
  );
  authorizedGroups.delete(groupJid);

  await sendFn(`🔴 Groupe désactivé. Le bot ne traitera plus les messages XP ici.`);
  console.log(`[SUPERADMIN] Groupe désactivé : ${groupJid}`);
}

// ── /add-admin @membre ────────────────────────────────────────
async function cmdAddAdmin(msg, adminPhones, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /add-admin @membre');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const member = await db.getMemberByPhone(phone);
  if (!member) { await sendFn('❌ Membre introuvable (il doit être inscrit).'); return; }

  await db.query(
    `INSERT INTO bot_admins (phone_number, added_by) VALUES ($1,$2)
     ON CONFLICT (phone_number) DO NOTHING`,
    [phone, msg.author?.replace('@c.us', '') || '']
  );
  adminPhones.add(phone);

  await sendFn(`✅ *${member.pseudo}* (${phone}) est maintenant admin bot.`);
  console.log(`[SUPERADMIN] add-admin : ${phone}`);
}

// ── /remove-admin @membre ─────────────────────────────────────
async function cmdRemoveAdmin(msg, adminPhones, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /remove-admin @membre');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');

  await db.query(`DELETE FROM bot_admins WHERE phone_number=$1`, [phone]);
  adminPhones.delete(phone);

  await sendFn(`✅ Droits admin retirés pour : *${phone}*`);
}

// ── /ban @membre <raison> ─────────────────────────────────────
async function cmdBan(msg, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /ban @membre <raison>');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const raison = (msg.body || '').replace(/^\/ban\s*/i, '').replace(/@\S+\s*/g, '').trim();
  if (!raison) { await sendFn('❌ Précise une raison pour le bannissement.'); return; }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  await db.withTransaction(async (client) => {
    await client.query(`UPDATE members SET status='banned', updated_at=now() WHERE id=$1`, [target.id]);
    await client.query(
      `INSERT INTO moderation_log (member_id, group_jid, action, level, reason, admin_id)
       VALUES ($1,$2,'ban','sanction',$3,$4)`,
      [target.id, msg.from, raison, null]
    );
  });

  await sendFn(`🚫 *${target.pseudo}* (${target.af_id}) a été banni.\nRaison : _${raison}_`);
  console.log(`[SUPERADMIN] ban : ${target.af_id} | raison: ${raison}`);
}

// ── /unban @membre ────────────────────────────────────────────
async function cmdUnban(msg, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /unban @membre');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  await db.query(`UPDATE members SET status='active', updated_at=now() WHERE id=$1`, [target.id]);
  await db.query(
    `INSERT INTO moderation_log (member_id, action, level, reason) VALUES ($1,'unban','information','Bannissement levé')`,
    [target.id]
  );

  await sendFn(`✅ *${target.pseudo}* est de nouveau actif.`);
}

// ── /change-numero @ancien @nouveau ──────────────────────────
async function cmdChangeNumero(msg, sendFn) {
  if (!msg.mentionedIds || msg.mentionedIds.length < 2) {
    await sendFn('❌ Usage : /change-numero @ancien_numero @nouveau_numero\n⚠️ Mentionne deux contacts.');
    return;
  }
  const oldPhone = msg.mentionedIds[0].replace('@c.us', '');
  const newPhone = msg.mentionedIds[1].replace('@c.us', '');

  const member = await db.getMemberByPhone(oldPhone);
  if (!member) { await sendFn('❌ Ancien numéro introuvable.'); return; }

  const existing = await db.getMemberByPhone(newPhone);
  if (existing) { await sendFn(`❌ Le nouveau numéro *${newPhone}* est déjà enregistré.`); return; }

  const raison = (msg.body || '').replace(/^\/change-numero\s*/i, '').replace(/@\S+\s*/g, '').trim() || 'Changement de numéro';

  await db.withTransaction(async (client) => {
    // Historique
    const oldHistory = member.old_phone_numbers || [];
    oldHistory.push({ number: oldPhone, replaced_at: new Date().toISOString() });
    await client.query(
      `UPDATE members SET phone_number=$1, old_phone_numbers=$2, updated_at=now() WHERE id=$3`,
      [newPhone, JSON.stringify(oldHistory), member.id]
    );
    await client.query(
      `INSERT INTO member_phone_history (member_id, old_phone, new_phone, reason)
       VALUES ($1,$2,$3,$4)`,
      [member.id, oldPhone, newPhone, raison]
    );
  });

  await sendFn(
    `✅ Numéro de *${member.pseudo}* modifié.\n` +
    `Ancien : *${oldPhone}*\n` +
    `Nouveau : *${newPhone}*\n` +
    `L'AF-ID *${member.af_id}* est conservé.`
  );
  console.log(`[SUPERADMIN] change-numero : ${oldPhone} → ${newPhone} (${member.af_id})`);
}

// ── /set-notif-groupe ─────────────────────────────────────────
async function cmdSetNotifGroupe(msg, sendFn) {
  const groupJid = msg.from;
  await db.query(
    `UPDATE system_config SET value=$1, updated_at=now() WHERE key='notification_group_jid'`,
    [groupJid]
  );
  await sendFn(
    `🔔 *Groupe de notifications centralisé défini !*\n` +
    `JID : \`${groupJid}\`\n\n` +
    `Toutes les notifications automatiques seront envoyées ici.`
  );
  console.log(`[SUPERADMIN] Groupe notif défini : ${groupJid}`);
}

// ── /drain-xp (test manuel du drain d'inactivité) ────────────
async function cmdDrainXp(msg, sendFn) {
  const config = await db.query(`SELECT value FROM system_config WHERE key IN ('xp_drain_enabled','xp_drain_amount','xp_drain_grace_days')`);
  const cfgMap = {};
  config.rows.forEach(r => { cfgMap[r.key] = r.value; });

  if (cfgMap['xp_drain_enabled'] !== 'true') {
    await sendFn('⚠️ Le drain XP est désactivé.\nActive-le dans system_config : xp_drain_enabled = true');
    return;
  }

  const amount = parseInt(cfgMap['xp_drain_amount']) || 100;
  const graceDays = parseInt(cfgMap['xp_drain_grace_days']) || 30;

  const res = await db.query(
    `UPDATE members SET xp_current = GREATEST(0, xp_current - $1), updated_at=now()
     WHERE status='active'
     AND registration_step='done'
     AND created_at < NOW() - INTERVAL '${graceDays} days'
     RETURNING id, pseudo, xp_current`,
    [amount]
  );

  await sendFn(
    `⚡ *Drain XP exécuté*\n\n` +
    `Montant : *-${amount} XP*\n` +
    `Membres affectés : *${res.rows.length}*\n` +
    `_(Nouveaux membres de moins de ${graceDays} jours protégés)_`
  );
  console.log(`[SUPERADMIN] Drain XP manuel : ${res.rows.length} membres affectés (-${amount}XP)`);
}

// ── /id (debug — JID du groupe) ───────────────────────────────
async function cmdId(msg, sendFn) {
  await sendFn(`🆔 JID de ce groupe :\n\`${msg.from}\``);
}

// ── /groupes (liste des groupes actifs) ───────────────────────
async function cmdGroupes(sendFn) {
  const res = await db.query(
    `SELECT group_name, group_jid, status, activated_at FROM whatsapp_groups ORDER BY activated_at DESC`
  );
  if (res.rows.length === 0) { await sendFn('Aucun groupe enregistré.'); return; }
  const lines = res.rows.map(g =>
    `${g.status === 'active' ? '✅' : '🔴'} *${g.group_name || 'Sans nom'}*\n   \`${g.group_jid}\``
  ).join('\n\n');
  await sendFn(`📋 *Groupes Afro'o Forever*\n\n${lines}`);
}

module.exports = {
  cmdActiverGroupe, cmdDesactiverGroupe,
  cmdAddAdmin, cmdRemoveAdmin,
  cmdBan, cmdUnban,
  cmdChangeNumero, cmdSetNotifGroupe,
  cmdDrainXp, cmdId, cmdGroupes,
};
