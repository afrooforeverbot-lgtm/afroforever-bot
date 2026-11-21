'use strict';
const db = require('../db');

// ── /profil ───────────────────────────────────────────────────
async function cmdProfil(msg, member, sendFn) {
  // Si mention, chercher ce membre
  let target = member;
  if (msg.mentionedIds && msg.mentionedIds.length > 0) {
    const phone = msg.mentionedIds[0].replace('@c.us', '');
    target = await db.getMemberByPhone(phone) || member;
  }

  if (!target || target.registration_step !== 'done') {
    await sendFn('❌ Membre introuvable ou inscription non terminée.');
    return;
  }

  const badges = await db.getMemberBadges(target.id);
  const favBadge = badges.find(b => b.is_favorite) || badges[0];
  const types = await db.query(
    `SELECT mt.name, mt.icon, mta.stars FROM member_type_assignments mta
     JOIN member_types mt ON mt.id = mta.type_id
     WHERE mta.member_id=$1 ORDER BY mta.stars DESC`,
    [target.id]
  );

  const typesLine = types.rows.length > 0
    ? types.rows.map(t => `${t.icon} ${t.name} ${'⭐'.repeat(t.stars || 0)}`).join(' | ')
    : '🔘 Neutre';

  const geoPath = target.geography_id ? await db.getFullGeographyPath(target.geography_id) : [];
  const geoLines = geoPath.map(g => {
    const labels = { empire: '🌍', royaume: '👑', legion: '⚔️', club: '🏫', district: '🏙️' };
    return `${labels[g.level_type] || '📍'} ${g.level_type.charAt(0).toUpperCase() + g.level_type.slice(1)} : *${g.name}*`;
  }).join('\n');

  await sendFn(
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *${target.pseudo}*\n` +
    `🆔 ${target.af_id}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    (target.titre ? `🏷️ *${target.titre}*\n\n` : '') +
    `${geoLines || '🌍 Empire Afro\'o Forever'}\n\n` +
    `━━ PROGRESSION ━━\n` +
    `📊 Niveau : *${target.level}*\n` +
    `⭐ XP actuel : *${target.xp_current}*\n` +
    `📈 XP historique : *${target.xp_historical}*\n` +
    `${target.grade_icon || '🪖'} Grade : *${target.grade_name || 'Recrue'}*\n` +
    `🪙 Afroo : *${target.afroo_balance}*\n\n` +
    `━━ TYPES ━━\n${typesLine}\n\n` +
    `━━ BADGES ━━\n` +
    (favBadge ? `${favBadge.icon || '🏅'} Favori : *${favBadge.name}*\n` : '') +
    `Total : *${badges.filter(b => !b.is_secret).length}* badge(s)\n\n` +
    (target.bio ? `💬 _${target.bio}_\n\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━━`
  );
}

// ── /xp ──────────────────────────────────────────────────────
async function cmdXp(msg, member, sendFn) {
  let target = member;
  if (msg.mentionedIds && msg.mentionedIds.length > 0) {
    const phone = msg.mentionedIds[0].replace('@c.us', '');
    target = await db.getMemberByPhone(phone);
    if (!target) { await sendFn('❌ Membre introuvable.'); return; }
  }

  const nextLevel = (target.level || 1) + 1;
  const xpForNext = nextLevel * 500;
  const progress = target.xp_historical % 500;
  const bar = buildProgressBar(progress, 500, 10);

  await sendFn(
    `⭐ *XP de ${target.pseudo}*\n\n` +
    `XP actuel : *${target.xp_current}*\n` +
    `XP historique : *${target.xp_historical}*\n` +
    `Niveau : *${target.level}*\n\n` +
    `Progression vers niveau ${nextLevel} :\n` +
    `${bar} ${progress}/500`
  );
}

// ── /classement ───────────────────────────────────────────────
async function cmdClassement(msg, member, sendFn) {
  const body = (msg.body || '').toLowerCase();

  if (body.includes('clubs') || body.includes('club')) {
    const top = await db.getTopGeography('club', 10);
    if (top.length === 0) { await sendFn('Aucun club enregistré pour le moment.'); return; }
    const lines = top.map((c, i) => `${medal(i)} *${c.name}* — ${c.total_xp} XP (${c.member_count} membres)`).join('\n');
    await sendFn(`🏫 *TOP CLUBS Afro'o Forever*\n\n${lines}`);
    return;
  }
  if (body.includes('légions') || body.includes('legions') || body.includes('legion')) {
    const top = await db.getTopGeography('legion', 10);
    const lines = top.map((l, i) => `${medal(i)} *${l.name}* — ${l.total_xp} XP`).join('\n');
    await sendFn(`⚔️ *TOP LÉGIONS Afro'o Forever*\n\n${lines}`);
    return;
  }
  if (body.includes('royaumes') || body.includes('royaume')) {
    const top = await db.getTopGeography('royaume', 10);
    const lines = top.map((r, i) => `${medal(i)} *${r.name}* — ${r.total_xp} XP`).join('\n');
    await sendFn(`👑 *TOP ROYAUMES Afro'o Forever*\n\n${lines}`);
    return;
  }

  // Top membres par défaut
  const top = await db.getTopMembers(20);
  if (top.length === 0) { await sendFn('Aucun membre au classement pour le moment.'); return; }
  const lines = top.map((m, i) =>
    `${medal(i)} *${m.pseudo}* — ${m.xp_current} XP | Niv.${m.level} | ${m.grade_icon || '🪖'} ${m.grade_name || 'Recrue'}`
  ).join('\n');
  await sendFn(`🏆 *TOP 20 Afro'o Forever*\n\n${lines}\n\n_/classement clubs | légions | royaumes_`);
}

// ── /grade ────────────────────────────────────────────────────
async function cmdGrade(msg, member, sendFn) {
  const grade = await db.getMemberGrade(member.id);
  const grades = await db.getGradeDefinitions();
  const current = grade ? grades.find(g => g.id === grade.grade_id) : grades[0];
  const nextGrade = current ? grades.find(g => g.rank_order === current.rank_order + 1 && g.universe === current.universe) : null;

  await sendFn(
    `🎖️ *Ton Grade*\n\n` +
    `${current?.icon || '🪖'} Grade actuel : *${current?.name || 'Recrue'}*\n` +
    `⭐ XP actuel : *${member.xp_current}*\n\n` +
    (nextGrade
      ? `⬆️ Grade suivant : *${nextGrade.icon} ${nextGrade.name}*\n` +
        `💸 Coût : *${nextGrade.xp_cost} XP* (définitivement retirés)\n\n` +
        `Tape */monter-grade* pour convertir`
      : `🌟 Tu es au grade maximum de l'Univers 1 !`)
  );
}

// ── /monter-grade ─────────────────────────────────────────────
async function cmdMonterGrade(msg, member, sendFn) {
  const grade = await db.getMemberGrade(member.id);
  const grades = await db.getGradeDefinitions();
  const current = grade ? grades.find(g => g.id === grade.grade_id) : grades[0];
  const next = current ? grades.find(g => g.rank_order === current.rank_order + 1 && g.universe === current.universe) : null;

  if (!next) {
    await sendFn('🌟 Tu es déjà au grade maximum ! Bravo Maréchal !');
    return;
  }
  if (member.xp_current < next.xp_cost) {
    await sendFn(
      `❌ XP insuffisant.\n\n` +
      `Requis : *${next.xp_cost} XP*\n` +
      `Ton XP actuel : *${member.xp_current} XP*\n` +
      `Manque : *${next.xp_cost - member.xp_current} XP*`
    );
    return;
  }

  // Stocker en attente de confirmation
  await db.updateMember(member.phone_number, {
    registration_data: JSON.stringify({
      pending_grade_upgrade: { grade_id: next.id, xp_cost: next.xp_cost, name: next.name, icon: next.icon }
    })
  });

  await sendFn(
    `⚠️ *Confirmation requise*\n\n` +
    `Tu vas passer au grade : *${next.icon} ${next.name}*\n\n` +
    `💸 Cette opération va retirer définitivement *${next.xp_cost} XP* de ton XP actuel.\n` +
    `🔒 Cette opération est *irréversible*.\n\n` +
    `Réponds *OUI* pour confirmer, ou *NON* pour annuler.`
  );
}

async function cmdConfirmGrade(msg, member, sendFn) {
  const data = member.registration_data || {};
  const pending = data.pending_grade_upgrade;
  if (!pending) return;

  const text = (msg.body || '').trim().toUpperCase();
  if (text === 'NON') {
    await db.updateMember(member.phone_number, { registration_data: JSON.stringify({}) });
    await sendFn('❌ Montée en grade annulée.');
    return;
  }
  if (text !== 'OUI') return;

  const grades = await db.getGradeDefinitions();
  const newGrade = grades.find(g => g.id === pending.grade_id);
  if (!newGrade) { await sendFn('❌ Grade introuvable.'); return; }

  await db.withTransaction(async (client) => {
    // Débiter XP
    await db.creditXP(client, member.id, -pending.xp_cost, 'grade_conversion', `grade_${pending.grade_id}`, null, `Montée grade → ${newGrade.name}`);
    // Mettre à jour le grade
    const grade = await client.query('SELECT id FROM member_grades WHERE member_id=$1', [member.id]);
    const oldGradeId = grade.rows[0]?.grade_id || null;
    if (grade.rows.length > 0) {
      await client.query(
        `UPDATE member_grades SET grade_id=$1, xp_spent_total=xp_spent_total+$2, updated_at=now() WHERE member_id=$3`,
        [pending.grade_id, pending.xp_cost, member.id]
      );
    } else {
      await client.query(
        `INSERT INTO member_grades (member_id, grade_id, xp_spent_total) VALUES ($1,$2,$3)`,
        [member.id, pending.grade_id, pending.xp_cost]
      );
    }
    await client.query(
      `INSERT INTO grade_history (member_id, old_grade_id, new_grade_id, xp_spent, reason) VALUES ($1,$2,$3,$4,$5)`,
      [member.id, oldGradeId, pending.grade_id, pending.xp_cost, 'upgrade']
    );
  });

  await db.updateMember(member.phone_number, { registration_data: JSON.stringify({}) });
  await sendFn(
    `🎖️ *FÉLICITATIONS ${member.pseudo} !*\n\n` +
    `Tu es maintenant : *${newGrade.icon} ${newGrade.name}*\n` +
    `💸 ${pending.xp_cost} XP ont été définitivement convertis.\n\n` +
    `🌟 Continue ta progression dans l'Empire Afro'o Forever !`
  );
}

// ── /badges ───────────────────────────────────────────────────
async function cmdBadges(msg, member, sendFn) {
  const badges = await db.getMemberBadges(member.id);
  const visible = badges.filter(b => !b.is_secret);
  if (visible.length === 0) {
    await sendFn('🏅 Tu n\'as pas encore de badges. Participe à la communauté pour en gagner !');
    return;
  }
  const lines = visible.map(b =>
    `${b.icon || '🏅'} *${b.name}* ${b.rarity === 'rare' ? '_(Rare)_' : b.rarity === 'legendary' ? '_(Légendaire)_' : ''}`
  ).join('\n');
  await sendFn(`🏆 *Badges de ${member.pseudo}* (${visible.length})\n\n${lines}`);
}

// ── /missions ─────────────────────────────────────────────────
async function cmdMissions(msg, member, sendFn) {
  const missions = await db.query(
    `SELECT md.title, md.difficulty, mm.status, mm.progress, mm.reward_claimed,
            md.rewards, md.ends_at
     FROM member_missions mm
     JOIN mission_definitions md ON md.id = mm.mission_id
     WHERE mm.member_id=$1 AND mm.status='in_progress'
     ORDER BY mm.started_at DESC LIMIT 10`,
    [member.id]
  );

  if (missions.rows.length === 0) {
    await sendFn('🎯 Aucune mission en cours. Les missions seront assignées automatiquement !');
    return;
  }

  const diffIcons = { facile: '🟢', normale: '🟡', difficile: '🟠', tres_difficile: '🔴', epique: '🟣', legendaire: '⚫' };
  const lines = missions.rows.map(m =>
    `${diffIcons[m.difficulty] || '⚪'} *${m.title}*\n` +
    `   Récompense : ${formatRewards(m.rewards)}`
  ).join('\n\n');

  await sendFn(`🎯 *Tes missions en cours*\n\n${lines}`);
}

// ── /afroo ────────────────────────────────────────────────────
async function cmdAfroo(msg, member, sendFn) {
  const stats = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS total_received,
            COALESCE(SUM(CASE WHEN amount<0 THEN ABS(amount) ELSE 0 END),0) AS total_spent
     FROM afroo_transactions WHERE member_id=$1`,
    [member.id]
  );
  const { total_received, total_spent } = stats.rows[0];
  await sendFn(
    `🪙 *L'Afroo de ${member.pseudo}*\n\n` +
    `Solde actuel : *${member.afroo_balance} Afroo*\n` +
    `Total reçu : ${total_received}\n` +
    `Total dépensé : ${total_spent}\n\n` +
    `_L'Afroo est rare et mystérieux.\nKeep exploring... 🌌_`
  );
}

// ── /stats ────────────────────────────────────────────────────
async function cmdStats(msg, member, sendFn) {
  const totalMembers = await db.query(`SELECT COUNT(*) FROM members WHERE status='active' AND registration_step='done'`);
  const totalXp = await db.query(`SELECT COALESCE(SUM(xp_current),0) AS total FROM members WHERE status='active'`);
  await sendFn(
    `📊 *Statistiques Afro'o Forever*\n\n` +
    `👥 Membres actifs : *${totalMembers.rows[0].count}*\n` +
    `⭐ XP total empire : *${totalXp.rows[0].total}*\n\n` +
    `_Tape /classement pour voir le top membres_`
  );
}

// ── Helpers ───────────────────────────────────────────────────
function medal(i) {
  if (i === 0) return '🥇';
  if (i === 1) return '🥈';
  if (i === 2) return '🥉';
  return `${i + 1}.`;
}

function buildProgressBar(current, max, length = 10) {
  const filled = Math.round((current / max) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

function formatRewards(rewards) {
  if (!rewards) return '—';
  const parts = [];
  if (rewards.xp) parts.push(`${rewards.xp} XP`);
  if (rewards.badge_name) parts.push(`Badge "${rewards.badge_name}"`);
  if (rewards.afroo) parts.push(`${rewards.afroo} Afroo`);
  return parts.join(' + ') || '—';
}

module.exports = {
  cmdProfil, cmdXp, cmdClassement, cmdGrade,
  cmdMonterGrade, cmdConfirmGrade,
  cmdBadges, cmdMissions, cmdAfroo, cmdStats,
};
