-- ============================================================
-- AFRO'O FOREVER — Schéma complet Phase 1
-- Version 1.0.0 — À exécuter dans Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- CONFIGURATION SYSTÈME (paramètres configurables)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_config (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_config (key, value, description) VALUES
  ('xp_per_message', '1', 'XP gagné par message valide'),
  ('xp_flush_interval_ms', '60000', 'Intervalle de flush XP en ms'),
  ('xp_drain_enabled', 'false', 'Activer la consommation XP périodique'),
  ('xp_drain_amount', '100', 'XP consommé lors du drain'),
  ('xp_drain_cron', '0 0 * * 0', 'Cron du drain (défaut: dimanche minuit)'),
  ('xp_drain_grace_days', '30', 'Jours de grâce pour les nouveaux membres'),
  ('xp_level_formula', 'floor(xp_historical/500)+1', 'Formule de niveau'),
  ('max_groups_per_bot', '20', 'Nombre max de groupes simultanés'),
  ('reconnect_delay_ms', '15000', 'Délai avant reconnexion WhatsApp'),
  ('cache_ttl_ms', '60000', 'Durée de vie des caches mémoire'),
  ('consent_version', '1.0', 'Version actuelle des CGU'),
  ('notification_group_jid', '', 'JID du groupe de notifications centralisé'),
  ('afroo_xp_rate', '100', 'XP requis pour 1 Afroo (taux variable)')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- GÉOGRAPHIE
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geography (
  id SERIAL PRIMARY KEY,
  level_type VARCHAR(20) NOT NULL CHECK (level_type IN ('empire','royaume','legion','club','district')),
  name VARCHAR(100) NOT NULL,
  parent_id INT REFERENCES geography(id) ON DELETE RESTRICT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Empire par défaut
INSERT INTO geography (level_type, name, parent_id)
VALUES ('empire', 'Empire Afro''o Forever', NULL)
ON CONFLICT DO NOTHING;

-- Royaumes initiaux
DO $$
DECLARE emp_id INT;
BEGIN
  SELECT id INTO emp_id FROM geography WHERE level_type = 'empire' LIMIT 1;
  INSERT INTO geography (level_type, name, parent_id) VALUES
    ('royaume', 'Cameroun', emp_id),
    ('royaume', 'France', emp_id),
    ('royaume', 'Côte d''Ivoire', emp_id),
    ('royaume', 'Belgique', emp_id),
    ('royaume', 'Canada', emp_id)
  ON CONFLICT DO NOTHING;
END $$;

-- Légions Cameroun
DO $$
DECLARE cam_id INT;
BEGIN
  SELECT id INTO cam_id FROM geography WHERE level_type = 'royaume' AND name = 'Cameroun' LIMIT 1;
  IF cam_id IS NOT NULL THEN
    INSERT INTO geography (level_type, name, parent_id) VALUES
      ('legion', 'Centre', cam_id),
      ('legion', 'Littoral', cam_id),
      ('legion', 'Ouest', cam_id),
      ('legion', 'Nord', cam_id),
      ('legion', 'Sud', cam_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Club Otaku De Soa
DO $$
DECLARE centre_id INT;
BEGIN
  SELECT id INTO centre_id FROM geography WHERE level_type = 'legion' AND name = 'Centre' LIMIT 1;
  IF centre_id IS NOT NULL THEN
    INSERT INTO geography (level_type, name, parent_id) VALUES
      ('club', 'Otaku De Soa', centre_id),
      ('district', 'District Centre', centre_id)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- MEMBRES
-- ────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS af_id_seq START 1;

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  af_id VARCHAR(10) UNIQUE NOT NULL DEFAULT ('AF-' || LPAD(nextval('af_id_seq')::TEXT, 6, '0')),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  old_phone_numbers JSONB DEFAULT '[]',
  pseudo VARCHAR(50),
  bio TEXT,
  titre VARCHAR(100),
  anime_favoris JSONB DEFAULT '[]',
  manga_favoris JSONB DEFAULT '[]',
  centres_interet JSONB DEFAULT '[]',
  geography_id INT REFERENCES geography(id),
  xp_current INT DEFAULT 0 CHECK (xp_current >= 0),
  xp_historical INT DEFAULT 0 CHECK (xp_historical >= 0),
  level INT DEFAULT 1,
  afroo_balance INT DEFAULT 0 CHECK (afroo_balance >= 0),
  registration_step VARCHAR(50) DEFAULT 'pending',
  registration_data JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','banned','deleted')),
  consent_version VARCHAR(10),
  consent_date TIMESTAMPTZ,
  profile_customization JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Historique des changements de numéro
CREATE TABLE IF NOT EXISTS member_phone_history (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  old_phone VARCHAR(20),
  new_phone VARCHAR(20),
  changed_by INT REFERENCES members(id),
  reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- Historique des modifications géographiques
CREATE TABLE IF NOT EXISTS member_geography_history (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  old_geography_id INT REFERENCES geography(id),
  new_geography_id INT REFERENCES geography(id),
  changed_by INT REFERENCES members(id),
  reason TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- TYPES DE MEMBRES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS member_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  icon VARCHAR(10),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO member_types (name, description, icon) VALUES
  ('WhatsApp', 'Participation active sur WhatsApp', '💬'),
  ('Événements', 'Participation aux événements physiques', '🎪'),
  ('Gaming', 'Jeux vidéo et compétitions gaming', '🎮'),
  ('Création', 'Création de contenu', '🎨'),
  ('Karaoke', 'Sessions karaoké', '🎤'),
  ('Leadership', 'Rôle de leadership', '👑'),
  ('Webtoon', 'Webtoons et manga', '📖'),
  ('Sport', 'Activités sportives', '⚽'),
  ('Investissement', 'Soutien financier ou logistique', '💼')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS member_type_assignments (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id) ON DELETE CASCADE,
  type_id INT REFERENCES member_types(id),
  stars INT DEFAULT 0,
  assigned_by INT REFERENCES members(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id, type_id)
);

-- ────────────────────────────────────────────────────────────
-- GRADES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grade_definitions (
  id SERIAL PRIMARY KEY,
  universe INT DEFAULT 1,
  rank_order INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  xp_cost INT NOT NULL DEFAULT 0,
  icon VARCHAR(10),
  privileges JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  UNIQUE(universe, rank_order)
);

INSERT INTO grade_definitions (universe, rank_order, name, xp_cost, icon) VALUES
  (1,  1,  'Recrue',            0,     '🪖'),
  (1,  2,  'Soldat',            100,   '⚔️'),
  (1,  3,  'Caporal',           300,   '🎖️'),
  (1,  4,  'Caporal-Chef',      600,   '🏅'),
  (1,  5,  'Sergent',           1000,  '🌟'),
  (1,  6,  'Sergent-Chef',      1500,  '⭐'),
  (1,  7,  'Adjudant',          2200,  '💫'),
  (1,  8,  'Lieutenant',        3000,  '🔱'),
  (1,  9,  'Capitaine',         4500,  '🛡️'),
  (1,  10, 'Commandant',        6500,  '⚡'),
  (1,  11, 'Lieutenant-Colonel',9000,  '🌠'),
  (1,  12, 'Colonel',           12000, '👑'),
  (1,  13, 'Général',           16000, '🏆'),
  (1,  14, 'Maréchal',          25000, '🌌')
ON CONFLICT (universe, rank_order) DO NOTHING;

CREATE TABLE IF NOT EXISTS member_grades (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id) ON DELETE CASCADE UNIQUE,
  grade_id INT REFERENCES grade_definitions(id),
  xp_spent_total INT DEFAULT 0,
  obtained_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grade_history (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  old_grade_id INT REFERENCES grade_definitions(id),
  new_grade_id INT REFERENCES grade_definitions(id),
  xp_spent INT DEFAULT 0,
  reason VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- LOG XP
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS xp_log (
  id BIGSERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  amount INT NOT NULL,
  xp_current_before INT,
  xp_current_after INT,
  xp_historical_before INT,
  xp_historical_after INT,
  source VARCHAR(50) NOT NULL,
  ref_id VARCHAR(100),
  admin_id INT REFERENCES members(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- BADGES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS badge_definitions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  category VARCHAR(50),
  rarity VARCHAR(20) DEFAULT 'common' CHECK (rarity IN ('common','rare','legendary','unique')),
  is_secret BOOLEAN DEFAULT false,
  is_temporary BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  max_holders INT,
  is_automatic BOOLEAN DEFAULT false,
  conditions JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_badges (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id) ON DELETE CASCADE,
  badge_id INT REFERENCES badge_definitions(id),
  obtained_at TIMESTAMPTZ DEFAULT now(),
  source VARCHAR(50),
  admin_id INT REFERENCES members(id),
  reason TEXT,
  is_favorite BOOLEAN DEFAULT false,
  UNIQUE(member_id, badge_id)
);

-- Badges de départ
INSERT INTO badge_definitions (name, description, icon, category, rarity, is_automatic) VALUES
  ('Fondateur', 'Membre fondateur d''Afro''o Forever', '👑', 'fondateur', 'unique', false),
  ('Première Connexion', 'A rejoint Afro''o Forever', '🌟', 'accomplissement', 'common', true),
  ('Première Mission', 'A complété sa première mission', '🎯', 'accomplissement', 'common', true),
  ('Actif de la Semaine', 'Membre le plus actif de la semaine', '🔥', 'activité', 'rare', true),
  ('Centurion', 'A atteint 100 XP', '💯', 'accomplissement', 'common', true),
  ('Millénaire', 'A atteint 1000 XP historique', '🏆', 'accomplissement', 'rare', true)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- MISSIONS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_definitions (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  type VARCHAR(30) CHECK (type IN ('daily','weekly','monthly','seasonal','event','secret','community','beginner','admin','global')),
  difficulty VARCHAR(20) DEFAULT 'normale' CHECK (difficulty IN ('facile','normale','difficile','tres_difficile','epique','legendaire')),
  conditions JSONB DEFAULT '{}',
  rewards JSONB DEFAULT '{}',
  is_secret BOOLEAN DEFAULT false,
  is_collective BOOLEAN DEFAULT false,
  prerequisite_mission_id INT REFERENCES mission_definitions(id),
  unlock_conditions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_missions (
  id SERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  member_id INT REFERENCES members(id) ON DELETE CASCADE,
  mission_id INT REFERENCES mission_definitions(id),
  progress JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed','expired')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  reward_claimed BOOLEAN DEFAULT false,
  UNIQUE(member_id, mission_id)
);

-- Missions de départ
INSERT INTO mission_definitions (title, description, type, difficulty, conditions, rewards, is_active) VALUES
  ('Bienvenue !', 'Complète ton profil en choisissant tes types de participation', 'beginner', 'facile',
   '{"type":"profile_complete"}', '{"xp":50,"badge_name":"Première Connexion"}', true),
  ('Première parole', 'Envoie ton premier message dans un groupe actif', 'beginner', 'facile',
   '{"type":"message_count","count":1}', '{"xp":10}', true),
  ('Bavard', 'Envoie 50 messages dans des groupes actifs', 'daily', 'normale',
   '{"type":"message_count","count":50}', '{"xp":100}', true),
  ('Centurion XP', 'Atteins 100 XP historique', 'global', 'normale',
   '{"type":"xp_historical_gte","value":100}', '{"xp":20,"badge_name":"Centurion"}', true)
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- L'AFROO
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS afroo_transactions (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  member_id INT REFERENCES members(id),
  amount INT NOT NULL,
  balance_before INT NOT NULL,
  balance_after INT NOT NULL,
  source VARCHAR(50) CHECK (source IN ('xp_conversion','bonus_mystery','purchase','auction','admin_grant','refund')),
  ref_id VARCHAR(100),
  admin_id INT REFERENCES members(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- ÉVÉNEMENTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  type VARCHAR(50),
  geography_id INT REFERENCES geography(id),
  organizer_id INT REFERENCES members(id),
  capacity INT,
  is_online BOOLEAN DEFAULT false,
  location_text TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','published','ongoing','finished','cancelled')),
  entry_conditions JSONB DEFAULT '{}',
  rewards JSONB DEFAULT '{}',
  qr_token VARCHAR(100),
  qr_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id SERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  event_id INT REFERENCES events(id),
  member_id INT REFERENCES members(id),
  status VARCHAR(20) DEFAULT 'registered' CHECK (status IN ('registered','confirmed','validated','cancelled','absent','present','waiting')),
  registered_at TIMESTAMPTZ DEFAULT now(),
  validated_at TIMESTAMPTZ,
  UNIQUE(event_id, member_id)
);

-- ────────────────────────────────────────────────────────────
-- JEUX
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_sessions (
  id SERIAL PRIMARY KEY,
  session_uid UUID DEFAULT uuid_generate_v4() UNIQUE,
  game_type VARCHAR(50) NOT NULL,
  group_jid VARCHAR,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','active','finished','cancelled')),
  config JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_participants (
  id SERIAL PRIMARY KEY,
  session_id INT REFERENCES game_sessions(id),
  member_id INT REFERENCES members(id),
  score INT DEFAULT 0,
  rank INT,
  data JSONB DEFAULT '{}',
  UNIQUE(session_id, member_id)
);

-- ────────────────────────────────────────────────────────────
-- GROUPES WHATSAPP
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id SERIAL PRIMARY KEY,
  group_jid VARCHAR NOT NULL UNIQUE,
  group_name VARCHAR,
  geography_id INT REFERENCES geography(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','disconnected','maintenance')),
  features_enabled JSONB DEFAULT '{"xp":true,"commands":true,"moderation":true}',
  settings JSONB DEFAULT '{}',
  activated_by VARCHAR,
  activated_at TIMESTAMPTZ DEFAULT now(),
  last_sync TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_admins (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR NOT NULL UNIQUE,
  added_by VARCHAR,
  permissions JSONB DEFAULT '["xp","badges","moderation"]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- MODÉRATION
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moderation_log (
  id BIGSERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  group_jid VARCHAR,
  action VARCHAR(50) NOT NULL,
  level VARCHAR(20) CHECK (level IN ('information','avertissement','infraction','grave','sanction')),
  reason TEXT,
  admin_id INT REFERENCES members(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','maintained','reduced','cancelled')),
  appeal_reason TEXT,
  appeal_handled_by INT REFERENCES members(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- BOUTIQUE & ENCHÈRES (architecture Phase 2)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shop_items (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  price_afroo INT NOT NULL,
  stock INT,
  type VARCHAR(30) CHECK (type IN ('digital','physical','partner','pass','event')),
  is_active BOOLEAN DEFAULT false,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id SERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  item_id INT REFERENCES shop_items(id),
  member_id INT REFERENCES members(id),
  price_paid INT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivered','cancelled')),
  purchased_at TIMESTAMPTZ DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auctions (
  id SERIAL PRIMARY KEY,
  item_id INT REFERENCES shop_items(id),
  min_bid INT NOT NULL,
  current_bid INT DEFAULT 0,
  current_bidder_id INT REFERENCES members(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','active','finished','cancelled')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  auction_id INT REFERENCES auctions(id),
  member_id INT REFERENCES members(id),
  amount INT NOT NULL,
  placed_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- GUERRE DES MONDES (architecture Phase 3)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS factions (
  id SERIAL PRIMARY KEY,
  faction_type VARCHAR(20) CHECK (faction_type IN ('monde','clan','famille')),
  name VARCHAR(100) NOT NULL,
  parent_id INT REFERENCES factions(id),
  geography_id INT REFERENCES geography(id),
  xp_pool INT DEFAULT 0,
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_factions (
  id SERIAL PRIMARY KEY,
  member_id INT REFERENCES members(id),
  faction_id INT REFERENCES factions(id),
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(member_id)
);

CREATE TABLE IF NOT EXISTS faction_xp_transfers (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key UUID DEFAULT uuid_generate_v4() UNIQUE,
  from_member_id INT REFERENCES members(id),
  to_faction_id INT REFERENCES factions(id),
  amount INT NOT NULL,
  transferred_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS notification_queue (
  id BIGSERIAL PRIMARY KEY,
  template_id INT REFERENCES notification_templates(id),
  target_jid VARCHAR,
  variables JSONB DEFAULT '{}',
  priority INT DEFAULT 5,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  scheduled_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- INDEX
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone_number);
CREATE INDEX IF NOT EXISTS idx_members_af_id ON members(af_id);
CREATE INDEX IF NOT EXISTS idx_members_geography ON members(geography_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);
CREATE INDEX IF NOT EXISTS idx_xp_log_member ON xp_log(member_id);
CREATE INDEX IF NOT EXISTS idx_xp_log_created ON xp_log(created_at);
CREATE INDEX IF NOT EXISTS idx_afroo_member ON afroo_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_member ON member_badges(member_id);
CREATE INDEX IF NOT EXISTS idx_member_missions_member ON member_missions(member_id);
CREATE INDEX IF NOT EXISTS idx_member_missions_status ON member_missions(status);
CREATE INDEX IF NOT EXISTS idx_moderation_member ON moderation_log(member_id);
CREATE INDEX IF NOT EXISTS idx_moderation_created ON moderation_log(created_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON game_sessions(status);