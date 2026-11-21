# 🌍 AFRO'O FOREVER — Bot WhatsApp
### Infrastructure communautaire complète · Phase 1 · 100 % gratuit

---

## 🚀 Démarrage rapide

### 1. Prérequis
- Node.js 18+
- Compte Supabase gratuit (supabase.com)
- Compte Railway gratuit (railway.app)
- Compte GitHub

### 2. Supabase — Initialiser la base
1. Créer un projet sur supabase.com
2. Aller dans **SQL Editor**
3. Coller tout le contenu de `sql/schema.sql`
4. Cliquer **Run**
5. Copier la **Connection string (URI)** depuis Project Settings → Database

### 3. Variables d'environnement
```
DATABASE_URL=postgresql://postgres:[PASS]@db.[REF].supabase.co:5432/postgres
SUPER_ADMIN_NUMBERS=237600000000,237600000001
PORT=8080
```

### 4. Lancer en local
```bash
npm install
cp .env.example .env
# Remplir .env
node bot.js
# Ouvrir http://localhost:8080 → Scanner le QR code
```

### 5. Déployer sur Railway
1. Pousser sur GitHub
2. Railway → New Project → Deploy from GitHub
3. Ajouter les variables d'environnement
4. Ajouter un Volume : Mount Path `/app/.wwebjs_auth`
5. Deploy → ouvrir l'URL publique → Scanner le QR

---

## ⚡ Commandes essentielles après déploiement

| Ordre | Action | Commande |
|---|---|---|
| 1 | Dans un groupe, activer le bot | `/activer-groupe` (super-admin) |
| 2 | Tester l'inscription | `/start` |
| 3 | Vérifier son profil | `/profil` |
| 4 | Voir l'aide complète | `/aide` |

---

## 📁 Structure du projet

```
bot.js              — Point d'entrée principal
config.js           — Configuration centralisée
db.js               — Pool PostgreSQL + helpers
registration.js     — Inscription guidée étape par étape
moderation.js       — Détection flood/spam automatique
server.js           — Serveur HTTP (QR code + /health)
commands/
  index.js          — Routeur de commandes
  public.js         — Commandes membres (/profil, /xp, /classement…)
  admin.js          — Commandes admins (/addxp, /badge…)
  superadmin.js     — Commandes super-admins (/activer-groupe…)
sql/
  schema.sql        — Schéma complet Supabase
```

---

## 🔐 Modèle de permissions

```
SUPER_ADMIN_NUMBERS (variable d'env — immuable par WhatsApp)
  └── Tous les droits + gestion des admins

bot_admins (table Supabase)
  └── Modération, XP, badges, types

Membres standards
  └── Commandes publiques uniquement
```

---

## 🗃️ Tables Supabase créées

`system_config` · `geography` · `members` · `member_phone_history`
`member_geography_history` · `member_types` · `member_type_assignments`
`grade_definitions` · `member_grades` · `grade_history` · `xp_log`
`badge_definitions` · `member_badges` · `mission_definitions`
`member_missions` · `afroo_transactions` · `events` · `event_registrations`
`game_sessions` · `game_participants` · `whatsapp_groups` · `bot_admins`
`moderation_log` · `shop_items` · `shop_purchases` · `auctions`
`auction_bids` · `factions` · `member_factions` · `faction_xp_transfers`
`notification_templates` · `notification_queue`

---

## 🔧 Dépannage

| Problème | Solution |
|---|---|
| QR code jamais affiché | Vérifier les logs Railway — erreur Chromium probable |
| Bot redemande QR | Volume Railway non monté sur `/app/.wwebjs_auth` |
| `/activer-groupe` refusé | Ton numéro doit être dans `SUPER_ADMIN_NUMBERS` |
| XP ne s'accumule pas | Groupe non activé — taper `/activer-groupe` |
| Erreur DB ECONNRESET | Supabase idle timeout — normal, le pool se reconnecte |

---

## 📈 Roadmap

- **Phase 1** (ce livrable) — Bot complet, inscription, XP, grades, badges, modération
- **Phase 2** — Dashboard web admin, moteur badges auto, missions automatiques, Afroo complet
- **Phase 3** — Événements, jeux, Guerre des Mondes / Clans / Familles
- **Phase 4** — Application mobile, partenaires, boutique, enchères

---

*Afro'o Forever © 2024 — ELOADXFAMILY — Tetang Tanekou Morel Noël*
