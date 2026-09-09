'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 10_000,
});

pool.on('error', (err) => {
  console.error('[DB ERROR] Erreur inattendue sur le pool :', err.message);
});

// ── Requête générique avec logs ───────────────────────────────
async function query(sql, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(sql, params);
    console.log(`[DB QUERY OK] ${Date.now() - start}ms — ${sql.substring(0, 60).replace(/\s+/g, ' ')}`);
    return res;
  } catch (err) {
    console.error(`[DB ERROR] ${err.message} | SQL: ${sql.substring(0, 80)}`);
    throw err;
  }
}

// ── Transactions atomiques ────────────────────────────────────
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Membres ───────────────────────────────────────────────────
async function getMemberByPhone(phone) {
  const res = await query(
    `SELECT m.*, g.name AS geography_name, g.level_type AS geography_type,
            gd.name AS grade_name, gd.icon AS grade_icon
     FROM members m
     LEFT JOIN geography g ON g.id = m.geography_id
     LEFT JOIN member_grades mg ON mg.member_id = m.id
     LEFT JOIN grade_definitions gd ON gd.id = mg.grade_id
     WHERE m.phone_number = $1 AND m.status != 'deleted'`,
    [phone]
  );
  return res.rows[0] || null;
}

async function getMemberById(id) {
  const res = await query(
    `SELECT m.*, g.name AS geography_name, g.level_type AS geography_type,
            gd.name AS grade_name, gd.icon AS grade_icon
     FROM members m
     LEFT JOIN geography g ON g.id = m.geography_id
     LEFT JOIN member_grades mg ON mg.member_id = m.id
     LEFT JOIN grade_definitions gd ON gd.id = mg.grade_id
     WHERE m.id = $1`,
    [id]
  );
  return res.rows[0] || null;
}

async function createMember(phone, registrationData = {}) {
  const res = await query(
    `INSERT INTO members (phone_number, registration_step, registration_data, status)
     VALUES ($1, 'step_welcome', $2, 'active')
     ON CONFLICT (phone_number) DO NOTHING
     RETURNING *`,
    [phone, JSON.stringify(registrationData)]
  );
  return res.rows[0] || null;
}

async function updateMember(phone, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const res = await query(
    `UPDATE members SET ${setClause}, updated_at = now() WHERE phone_number = $1 RETURNING *`,
    [phone, ...values]
  );
  return res.rows[0] || null;
}

// ── XP ────────────────────────────────────────────────────────
async function creditXP(client, memberId, amount, source, refId = null, adminId = null, note = null) {
  // Lire état actuel
  const cur = await client.query(
    'SELECT xp_current, xp_historical FROM members WHERE id = $1 FOR UPDATE',
    [memberId]
  );
  if (!cur.rows[0]) throw new Error('Membre introuvable pour crédit XP');

  const { xp_current, xp_historical } = cur.rows[0];
  const newCurrent = Math.max(0, xp_current + amount);
  const newHistorical = amount > 0 ? xp_historical + amount : xp_historical;
  const newLevel = Math.floor(newHistorical / 500) + 1;

  // Mettre à jour le membre
  await client.query(
    `UPDATE members SET xp_current=$1, xp_historical=$2, level=$3, updated_at=now() WHERE id=$4`,
    [newCurrent, newHistorical, newLevel, memberId]
  );

  // Logger
  await client.query(
    `INSERT INTO xp_log (member_id, amount, xp_current_before, xp_current_after,
      xp_historical_before, xp_historical_after, source, ref_id, admin_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [memberId, amount, xp_current, newCurrent, xp_historical, newHistorical, source, refId, adminId, note]
  );

  return { newCurrent, newHistorical, newLevel };
}

// Flush du lot XP accumulé en mémoire
async function flushXPBatch(pendingMap) {
  if (pendingMap.size === 0) return 0;
  const entries = [...pendingMap.entries()];
  pendingMap.clear();

  let saved = 0;
  await withTransaction(async (client) => {
    for (const [phone, amount] of entries) {
      const res = await client.query('SELECT id FROM members WHERE phone_number=$1 AND status=$2', [phone, 'active']);
      if (!res.rows[0]) continue;
      await creditXP(client, res.rows[0].id, amount, 'message');
      saved++;
    }
  });
  console.log(`[XP FLUSH] ${saved} membres crédités`);
  return saved;
}

// ── Groupes & Admins (caches) ─────────────────────────────────
async function loadAuthorizedGroups() {
  const res = await query('SELECT group_jid, group_name, features_enabled, settings FROM whatsapp_groups WHERE status=$1', ['active']);
  const map = new Map();
  for (const row of res.rows) map.set(row.group_jid, row);
  return map;
}

async function loadBotAdmins() {
  const res = await query('SELECT phone_number, permissions FROM bot_admins', []);
  const set = new Set(res.rows.map(r => r.phone_number));
  return set;
}

async function loadSysConfig() {
  const res = await query('SELECT key, value FROM system_config', []);
  return res.rows;
}

// ── Géographie ────────────────────────────────────────────────
async function getGeographyByType(levelType, parentId = null) {
  const res = await query(
    `SELECT id, name FROM geography WHERE level_type=$1 AND ($2::int IS NULL OR parent_id=$2) AND active=true ORDER BY name`,
    [levelType, parentId]
  );
  return res.rows;
}

async function getFullGeographyPath(geographyId) {
  const res = await query(
    `WITH RECURSIVE path AS (
       SELECT id, name, level_type, parent_id FROM geography WHERE id=$1
       UNION ALL
       SELECT g.id, g.name, g.level_type, g.parent_id FROM geography g
       JOIN path p ON g.id = p.parent_id
     ) SELECT * FROM path ORDER BY
       CASE level_type WHEN 'empire' THEN 1 WHEN 'royaume' THEN 2 WHEN 'legion' THEN 3 ELSE 4 END`,
    [geographyId]
  );
  return res.rows;
}

// ── Top classement ────────────────────────────────────────────
async function getTopMembers(limit = 20) {
  const res = await query(
    `SELECT m.pseudo, m.af_id, m.xp_current, m.xp_historical, m.level,
            gd.name AS grade_name, gd.icon AS grade_icon
     FROM members m
     LEFT JOIN member_grades mg ON mg.member_id = m.id
     LEFT JOIN grade_definitions gd ON gd.id = mg.grade_id
     WHERE m.status = 'active' AND m.pseudo IS NOT NULL
     ORDER BY m.xp_current DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

async function getTopGeography(levelType, limit = 10) {
  const res = await query(
    `SELECT g.name, g.level_type,
            COALESCE(SUM(m.xp_current), 0) AS total_xp,
            COUNT(m.id) AS member_count
     FROM geography g
     LEFT JOIN members m ON m.geography_id = g.id AND m.status = 'active'
     WHERE g.level_type = $1 AND g.active = true
     GROUP BY g.id, g.name, g.level_type
     ORDER BY total_xp DESC LIMIT $2`,
    [levelType, limit]
  );
  return res.rows;
}

// ── Grades ────────────────────────────────────────────────────
async function getGradeDefinitions() {
  const res = await query('SELECT * FROM grade_definitions WHERE active=true ORDER BY universe, rank_order', []);
  return res.rows;
}

async function getMemberGrade(memberId) {
  const res = await query(
    `SELECT mg.*, gd.name, gd.icon, gd.xp_cost, gd.rank_order, gd.universe
     FROM member_grades mg
     JOIN grade_definitions gd ON gd.id = mg.grade_id
     WHERE mg.member_id = $1`,
    [memberId]
  );
  return res.rows[0] || null;
}

// ── Badges ────────────────────────────────────────────────────
async function getMemberBadges(memberId) {
  const res = await query(
    `SELECT bd.name, bd.icon, bd.category, bd.rarity, bd.is_secret,
            mb.obtained_at, mb.is_favorite
     FROM member_badges mb
     JOIN badge_definitions bd ON bd.id = mb.badge_id
     WHERE mb.member_id = $1
     ORDER BY mb.obtained_at DESC`,
    [memberId]
  );
  return res.rows;
}

async function awardBadge(memberId, badgeName, source, adminId = null, reason = null) {
  const badge = await query('SELECT id, max_holders FROM badge_definitions WHERE name=$1 AND active=true', [badgeName]);
  if (!badge.rows[0]) return null;
  const { id: badgeId, max_holders } = badge.rows[0];

  if (max_holders !== null) {
    const count = await query('SELECT COUNT(*) FROM member_badges WHERE badge_id=$1', [badgeId]);
    if (parseInt(count.rows[0].count) >= max_holders) return null;
  }

  try {
    await query(
      `INSERT INTO member_badges (member_id, badge_id, source, admin_id, reason)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [memberId, badgeId, source, adminId, reason]
    );
    return true;
  } catch { return null; }
}

// ── Fermeture propre ──────────────────────────────────────────
async function close() {
  await pool.end();
}

module.exports = {
  query, withTransaction,
  getMemberByPhone, getMemberById, createMember, updateMember,
  creditXP, flushXPBatch,
  loadAuthorizedGroups, loadBotAdmins, loadSysConfig,
  getGeographyByType, getFullGeographyPath,
  getTopMembers, getTopGeography,
  getGradeDefinitions, getMemberGrade,
  getMemberBadges, awardBadge,
  close,
};
