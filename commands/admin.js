'use strict';
const db = require('../db');

// ── /addxp @membre <montant> ──────────────────────────────────
async function cmdAddXp(msg, member, sendFn) {
  const parts = (msg.body || '').trim().split(/\s+/);
  const amount = parseInt(parts[parts.length - 1]);
  if (!msg.mentionedIds?.length || isNaN(amount) || amount <= 0) {
    await sendFn('❌ Usage : /addxp @membre <montant>\nExemple : /addxp @Jean 50');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const target = await db.getMemberByPhone(phone);
  if (!target || target.registration_step !== 'done') {
    await sendFn('❌ Membre introuvable ou inscription non terminée.');
    return;
  }

  await db.withTransaction(async (client) => {
    await db.creditXP(client, target.id, amount, 'admin', null, member.id, `Admin addxp par ${member.pseudo}`);
  });

  const updated = await db.getMemberByPhone(phone);
  await sendFn(
    `✅ *+${amount} XP* attribués à *${target.pseudo}*\n\n` +
    `XP actuel : *${updated.xp_current}*\n` +
    `XP historique : *${updated.xp_historical}*\n` +
    `Niveau : *${updated.level}*`
  );
  console.log(`[CMD ADMIN] addxp | admin:${member.af_id} → ${target.af_id} +${amount}XP`);
}

// ── /removexp @membre <montant> ───────────────────────────────
async function cmdRemoveXp(msg, member, sendFn) {
  const parts = (msg.body || '').trim().split(/\s+/);
  const amount = parseInt(parts[parts.length - 1]);
  if (!msg.mentionedIds?.length || isNaN(amount) || amount <= 0) {
    await sendFn('❌ Usage : /removexp @membre <montant>');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  await db.withTransaction(async (client) => {
    await db.creditXP(client, target.id, -amount, 'admin', null, member.id, `Admin removexp par ${member.pseudo}`);
  });

  const updated = await db.getMemberByPhone(phone);
  await sendFn(
    `✅ *-${amount} XP* retirés à *${target.pseudo}*\n` +
    `XP actuel restant : *${updated.xp_current}*`
  );
}

// ── /badge @membre <nom_badge> ────────────────────────────────
async function cmdBadge(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /badge @membre <nom du badge>\nExemple : /badge @Jean Fondateur');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const bodyAfterCmd = (msg.body || '').replace(/^\/badge\s*/i, '').replace(/@\S+\s*/g, '').trim();
  if (!bodyAfterCmd) { await sendFn('❌ Précise le nom du badge.'); return; }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  const result = await db.awardBadge(target.id, bodyAfterCmd, 'manual', member.id, `Attribué par admin ${member.pseudo}`);
  if (!result) {
    await sendFn(`❌ Badge introuvable, inactif, ou quota atteint : *${bodyAfterCmd}*`);
    return;
  }
  await sendFn(`🏅 Badge *${bodyAfterCmd}* attribué à *${target.pseudo}* !`);
  console.log(`[CMD ADMIN] badge | admin:${member.af_id} → ${target.af_id} "${bodyAfterCmd}"`);
}

// ── /setgrade @membre <rang> ──────────────────────────────────
async function cmdSetGrade(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /setgrade @membre <rang>\nExemple : /setgrade @Jean 5');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const parts = (msg.body || '').trim().split(/\s+/);
  const rankOrder = parseInt(parts[parts.length - 1]);
  if (isNaN(rankOrder) || rankOrder < 1) { await sendFn('❌ Précise le rang (ex: 5 pour Sergent).'); return; }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  const grades = await db.getGradeDefinitions();
  const newGrade = grades.find(g => g.rank_order === rankOrder && g.universe === 1);
  if (!newGrade) { await sendFn(`❌ Rang ${rankOrder} introuvable.`); return; }

  await db.withTransaction(async (client) => {
    const existing = await client.query('SELECT grade_id FROM member_grades WHERE member_id=$1', [target.id]);
    if (existing.rows.length > 0) {
      await client.query(`UPDATE member_grades SET grade_id=$1, updated_at=now() WHERE member_id=$2`, [newGrade.id, target.id]);
    } else {
      await client.query(`INSERT INTO member_grades (member_id, grade_id) VALUES ($1,$2)`, [target.id, newGrade.id]);
    }
    await client.query(
      `INSERT INTO grade_history (member_id, old_grade_id, new_grade_id, xp_spent, reason) VALUES ($1,$2,$3,0,$4)`,
      [target.id, existing.rows[0]?.grade_id || null, newGrade.id, `Admin setgrade par ${member.pseudo}`]
    );
  });

  await sendFn(`✅ Grade de *${target.pseudo}* défini à : *${newGrade.icon} ${newGrade.name}*`);
}

// ── /settype @membre <type> <étoiles> ────────────────────────
async function cmdSetType(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /settype @membre <nom_type> <étoiles>\nExemple : /settype @Jean Gaming 3');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const bodyClean = (msg.body || '').replace(/^\/settype\s*/i, '').replace(/@\S+\s*/g, '').trim();
  const partsBody = bodyClean.split(/\s+/);
  const stars = parseInt(partsBody[partsBody.length - 1]);
  const typeName = partsBody.slice(0, -1).join(' ');

  if (!typeName || isNaN(stars) || stars < 0) {
    await sendFn('❌ Usage : /settype @membre <type> <étoiles>\nExemple : /settype @Jean Gaming 3');
    return;
  }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  const typeRes = await db.query('SELECT id FROM member_types WHERE name ILIKE $1 AND active=true', [typeName]);
  if (!typeRes.rows[0]) { await sendFn(`❌ Type introuvable : *${typeName}*`); return; }

  const typeId = typeRes.rows[0].id;
  await db.query(
    `INSERT INTO member_type_assignments (member_id, type_id, stars, assigned_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (member_id, type_id) DO UPDATE SET stars=$3, assigned_by=$4, updated_at=now()`,
    [target.id, typeId, stars, member.id]
  );

  await sendFn(`✅ *${target.pseudo}* : type *${typeName}* défini à *${'⭐'.repeat(stars) || '0 étoile'}*`);
}

// ── /warn @membre <raison> ────────────────────────────────────
async function cmdWarn(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /warn @membre <raison>');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const raison = (msg.body || '').replace(/^\/warn\s*/i, '').replace(/@\S+\s*/g, '').trim();
  if (!raison) { await sendFn('❌ Précise une raison pour l\'avertissement.'); return; }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  const groupJid = msg.from;
  await db.query(
    `INSERT INTO moderation_log (member_id, group_jid, action, level, reason, admin_id)
     VALUES ($1,$2,'warning','avertissement',$3,$4)`,
    [target.id, groupJid, raison, member.id]
  );

  // Compter les avertissements
  const count = await db.query(
    `SELECT COUNT(*) FROM moderation_log WHERE member_id=$1 AND level='avertissement' AND status='active'`,
    [target.id]
  );

  await sendFn(
    `⚠️ *Avertissement officiel* envoyé à *${target.pseudo}*\n` +
    `Raison : _${raison}_\n` +
    `Total avertissements : *${count.rows[0].count}*`
  );
  console.log(`[CMD ADMIN] warn | admin:${member.af_id} → ${target.af_id} | raison: ${raison}`);
}

// ── /info-membre @membre ──────────────────────────────────────
async function cmdInfoMembre(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /info-membre @membre');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  const sanctions = await db.query(
    `SELECT COUNT(*) FROM moderation_log WHERE member_id=$1 AND status='active'`,
    [target.id]
  );
  const badges = await db.getMemberBadges(target.id);
  const grade = await db.getMemberGrade(target.id);

  await sendFn(
    `🔍 *Fiche technique : ${target.pseudo}*\n\n` +
    `🆔 AF-ID : *${target.af_id}*\n` +
    `📱 Numéro : *${target.phone_number}*\n` +
    `📅 Inscrit le : *${target.created_at?.toLocaleDateString('fr-FR') || '—'}*\n` +
    `🔄 Statut : *${target.status}*\n\n` +
    `⭐ XP actuel : *${target.xp_current}*\n` +
    `📈 XP historique : *${target.xp_historical}*\n` +
    `🎖️ Grade : *${grade?.name || 'Recrue'}*\n` +
    `🪙 Afroo : *${target.afroo_balance}*\n` +
    `🏅 Badges : *${badges.length}*\n` +
    `⚠️ Sanctions actives : *${sanctions.rows[0].count}*`
  );
}

// ── /afroo-give @membre <montant> ─────────────────────────────
async function cmdAfrooGive(msg, member, sendFn) {
  if (!msg.mentionedIds?.length) {
    await sendFn('❌ Usage : /afroo-give @membre <montant>');
    return;
  }
  const phone = msg.mentionedIds[0].replace('@c.us', '');
  const parts = (msg.body || '').trim().split(/\s+/);
  const amount = parseInt(parts[parts.length - 1]);
  if (isNaN(amount) || amount <= 0) { await sendFn('❌ Montant invalide.'); return; }

  const target = await db.getMemberByPhone(phone);
  if (!target) { await sendFn('❌ Membre introuvable.'); return; }

  await db.withTransaction(async (client) => {
    const before = target.afroo_balance;
    const after = before + amount;
    await client.query(
      `UPDATE members SET afroo_balance=$1, updated_at=now() WHERE id=$2`,
      [after, target.id]
    );
    await client.query(
      `INSERT INTO afroo_transactions (member_id, amount, balance_before, balance_after, source, admin_id, reason)
       VALUES ($1,$2,$3,$4,'admin_grant',$5,$6)`,
      [target.id, amount, before, after, member.id, `Don admin par ${member.pseudo}`]
    );
  });

  await sendFn(`🪙 *+${amount} Afroo* donnés à *${target.pseudo}* ! 🌌`);
  console.log(`[CMD ADMIN] afroo-give | admin:${member.af_id} → ${target.af_id} +${amount} Afroo`);
}

module.exports = {
  cmdAddXp, cmdRemoveXp, cmdBadge, cmdSetGrade,
  cmdSetType, cmdWarn, cmdInfoMembre, cmdAfrooGive,
};
