'use strict';
const db = require('./db');
const config = require('./config');

// Étapes d'inscription dans l'ordre
const STEPS = [
  'step_welcome',
  'step_pseudo',
  'step_royaume',
  'step_legion',
  'step_club_or_district',
  'step_structure_choice',
  'step_types',
  'step_confirm',
  'done',
];

// ── Point d'entrée principal ──────────────────────────────────
async function handleRegistration(msg, member, sendFn) {
  const text = (msg.body || '').trim();
  const step = member.registration_step;
  const data = member.registration_data || {};

  console.log(`[REGISTER] ${member.phone_number} | étape: ${step} | texte: "${text}"`);

  switch (step) {
    case 'step_welcome':    return stepWelcome(member, sendFn);
    case 'step_pseudo':     return stepPseudo(text, member, sendFn);
    case 'step_royaume':    return stepRoyaume(text, member, data, sendFn);
    case 'step_legion':     return stepLegion(text, member, data, sendFn);
    case 'step_club_or_district': return stepClubOrDistrict(text, member, data, sendFn);
    case 'step_structure_choice': return stepStructureChoice(text, member, data, sendFn);
    case 'step_types':      return stepTypes(text, member, data, sendFn);
    case 'step_confirm':    return stepConfirm(text, member, data, sendFn);
    default:
      await sendFn('Ton inscription est déjà terminée ! Tape */profil* pour voir ton profil.');
  }
}

// ── Étape 0 : Accueil ─────────────────────────────────────────
async function stepWelcome(member, sendFn) {
  await sendFn(
    `🌍 *Bienvenue dans l'Empire Afro'o Forever !*\n\n` +
    `Je vais t'inscrire en quelques étapes rapides.\n\n` +
    `📜 *Conditions d'utilisation (v${config.get('CONSENT_VERSION') || '1.0'})* :\n` +
    `• Respect de la communauté\n` +
    `• Un seul compte par personne\n` +
    `• Tes données sont utilisées uniquement dans le cadre d'Afro'o Forever\n\n` +
    `Pour continuer, réponds *J'accepte*`
  );
}

// ── Étape 1 : Pseudo ─────────────────────────────────────────
async function stepPseudo(text, member, sendFn) {
  if (!['j\'accepte', 'jaccepte', 'oui', 'accept', 'j accepte'].includes(text.toLowerCase())) {
    await sendFn('Pour rejoindre Afro\'o Forever, réponds *J\'accepte* pour valider les conditions.');
    return;
  }
  // Enregistrer le consentement
  await db.updateMember(member.phone_number, {
    registration_step: 'step_pseudo',
    consent_version: config.get('CONSENT_VERSION') || '1.0',
    consent_date: new Date().toISOString(),
  });
  await sendFn('✅ Conditions acceptées !\n\n👤 *Choisis ton pseudo Afro\'o Forever* :\n_(3 à 30 caractères, pas de symboles spéciaux)_');
}

// ── Étape 2 : Pseudo saisi ────────────────────────────────────
async function stepRoyaume(text, member, data, sendFn) {
  const pseudo = text.trim();
  if (pseudo.length < 3 || pseudo.length > 30) {
    await sendFn('❌ Le pseudo doit faire entre 3 et 30 caractères. Réessaie :');
    return;
  }
  if (!/^[a-zA-ZÀ-ÿ0-9 _\-'.]+$/.test(pseudo)) {
    await sendFn('❌ Pseudo invalide. Utilise uniquement des lettres, chiffres, espaces ou _ - \' .');
    return;
  }
  // Vérifier unicité
  const existing = await db.query('SELECT id FROM members WHERE pseudo ILIKE $1', [pseudo]);
  if (existing.rows.length > 0) {
    await sendFn(`❌ Le pseudo *${pseudo}* est déjà pris. Choisis-en un autre :`);
    return;
  }

  const newData = { ...data, pseudo };
  await db.updateMember(member.phone_number, {
    registration_step: 'step_royaume',
    registration_data: JSON.stringify(newData),
  });

  const royaumes = await db.getGeographyByType('royaume');
  const list = royaumes.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
  await sendFn(
    `✅ Pseudo choisi : *${pseudo}*\n\n` +
    `🌍 *Choisis ton Royaume* :\n\n${list}\n\n` +
    `_(Réponds avec le numéro)_`
  );
  // Stocker la liste pour référence
  await db.query(
    `UPDATE members SET registration_data=$1 WHERE phone_number=$2`,
    [JSON.stringify({ ...newData, royaumes_ids: royaumes.map(r => r.id), royaumes_names: royaumes.map(r => r.name) }), member.phone_number]
  );
}

// ── Étape 3 : Légion ─────────────────────────────────────────
async function stepLegion(text, member, data, sendFn) {
  const idx = parseInt(text) - 1;
  const royaumesIds = data.royaumes_ids || [];
  if (isNaN(idx) || idx < 0 || idx >= royaumesIds.length) {
    await sendFn('❌ Numéro invalide. Réponds avec le numéro du Royaume :');
    return;
  }
  const royaumeId = royaumesIds[idx];
  const royaumeName = (data.royaumes_names || [])[idx];

  const legions = await db.getGeographyByType('legion', royaumeId);
  if (legions.length === 0) {
    await sendFn('⚠️ Aucune légion disponible dans ce royaume pour l\'instant. Choisis un autre Royaume :');
    return;
  }

  const newData = { ...data, royaume_id: royaumeId, royaume_name: royaumeName,
    legions_ids: legions.map(l => l.id), legions_names: legions.map(l => l.name) };
  await db.updateMember(member.phone_number, {
    registration_step: 'step_legion',
    registration_data: JSON.stringify(newData),
  });

  const list = legions.map((l, i) => `${i + 1}. ${l.name}`).join('\n');
  await sendFn(`✅ Royaume : *${royaumeName}*\n\n⚔️ *Choisis ta Légion* :\n\n${list}\n\n_(Réponds avec le numéro)_`);
}

// ── Étape 4 : Club ou District ? ─────────────────────────────
async function stepClubOrDistrict(text, member, data, sendFn) {
  const idx = parseInt(text) - 1;
  const legionsIds = data.legions_ids || [];
  if (isNaN(idx) || idx < 0 || idx >= legionsIds.length) {
    await sendFn('❌ Numéro invalide. Réponds avec le numéro de la Légion :');
    return;
  }
  const legionId = legionsIds[idx];
  const legionName = (data.legions_names || [])[idx];

  const newData = { ...data, legion_id: legionId, legion_name: legionName };
  await db.updateMember(member.phone_number, {
    registration_step: 'step_club_or_district',
    registration_data: JSON.stringify(newData),
  });

  await sendFn(
    `✅ Légion : *${legionName}*\n\n` +
    `🏫 *Tu appartiens à :*\n\n` +
    `1. Un *Club* (étudiant, lycéen, universitaire)\n` +
    `2. Un *District* (toute autre situation)\n\n` +
    `_(Réponds 1 ou 2)_`
  );
}

// ── Étape 5 : Choix structure précise ────────────────────────
async function stepStructureChoice(text, member, data, sendFn) {
  const choice = text.trim();
  if (!['1', '2'].includes(choice)) {
    await sendFn('❌ Réponds *1* pour Club ou *2* pour District.');
    return;
  }
  const levelType = choice === '1' ? 'club' : 'district';
  const label = choice === '1' ? 'Club' : 'District';

  const structures = await db.getGeographyByType(levelType, data.legion_id);
  if (structures.length === 0) {
    // Pas de structure disponible — on affecte directement à la légion
    await finalizeRegistration(member, data, data.legion_id, data.legion_name, sendFn);
    return;
  }

  const newData = { ...data, structure_type: levelType,
    structures_ids: structures.map(s => s.id), structures_names: structures.map(s => s.name) };
  await db.updateMember(member.phone_number, {
    registration_step: 'step_structure_choice',
    registration_data: JSON.stringify(newData),
  });

  const list = structures.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
  await sendFn(`✅ Type : *${label}*\n\n🏫 *Choisis ton ${label}* :\n\n${list}\n\n_(Réponds avec le numéro)_`);
}

// ── Étape 6 : Types de participation ─────────────────────────
async function stepTypes(text, member, data, sendFn) {
  // Cette étape est atteinte après le choix de structure OU après structure_choice
  // On détecte si l'utilisateur choisit encore la structure
  if (data.structures_ids) {
    const idx = parseInt(text) - 1;
    if (isNaN(idx) || idx < 0 || idx >= data.structures_ids.length) {
      await sendFn('❌ Numéro invalide. Réessaie :');
      return;
    }
    const geoId = data.structures_ids[idx];
    const geoName = data.structures_names[idx];
    const newData = { ...data, geography_id: geoId, geography_name: geoName };
    delete newData.structures_ids;
    delete newData.structures_names;
    await db.updateMember(member.phone_number, {
      registration_step: 'step_types',
      registration_data: JSON.stringify(newData),
    });
    await askTypes(sendFn, geoName);
    return;
  }
  // Sinon : traiter la sélection des types
  await processTypes(text, member, data, sendFn);
}

async function askTypes(sendFn, geoName) {
  const types = await db.query('SELECT id, name, icon FROM member_types WHERE active=true ORDER BY id');
  const list = types.rows.map((t, i) => `${i + 1}. ${t.icon} ${t.name}`).join('\n');
  await sendFn(
    `✅ Structure : *${geoName}*\n\n` +
    `🧩 *Choisis tes types de participation* :\n\n${list}\n\n` +
    `_(Plusieurs choix possibles : ex. 1,3,5 — ou tape 0 pour Neutre)_`
  );
}

async function processTypes(text, member, data, sendFn) {
  const types = await db.query('SELECT id, name, icon FROM member_types WHERE active=true ORDER BY id');
  const typeRows = types.rows;
  let selectedIds = [];

  if (text.trim() !== '0') {
    const parts = text.split(',').map(p => parseInt(p.trim()) - 1);
    const invalid = parts.filter(i => isNaN(i) || i < 0 || i >= typeRows.length);
    if (invalid.length > 0) {
      const list = typeRows.map((t, i) => `${i + 1}. ${t.icon} ${t.name}`).join('\n');
      await sendFn(`❌ Numéro(s) invalide(s). Choisis parmi :\n\n${list}\n\n_(ex: 1,3,5 ou 0 pour Neutre)_`);
      return;
    }
    selectedIds = parts.map(i => typeRows[i].id);
  }

  const newData = { ...data, type_ids: selectedIds };
  await db.updateMember(member.phone_number, {
    registration_step: 'step_confirm',
    registration_data: JSON.stringify(newData),
  });

  // Récap
  const typeNames = selectedIds.length > 0
    ? selectedIds.map(id => { const t = typeRows.find(r => r.id === id); return t ? `${t.icon} ${t.name}` : ''; }).join(', ')
    : '🔘 Neutre';

  await sendFn(
    `📋 *Récapitulatif de ton inscription :*\n\n` +
    `👤 Pseudo : *${newData.pseudo}*\n` +
    `🌍 Empire : *Afro'o Forever*\n` +
    `👑 Royaume : *${newData.royaume_name || '—'}*\n` +
    `⚔️ Légion : *${newData.legion_name || '—'}*\n` +
    `🏫 Structure : *${newData.geography_name || '—'}*\n` +
    `🧩 Types : ${typeNames}\n\n` +
    `Pour confirmer, réponds *Confirmer*\n` +
    `Pour recommencer, réponds *Recommencer*`
  );
}

// ── Étape 7 : Confirmation finale ────────────────────────────
async function stepConfirm(text, member, data, sendFn) {
  const t = text.toLowerCase().trim();
  if (t === 'recommencer') {
    await db.updateMember(member.phone_number, {
      registration_step: 'step_welcome',
      registration_data: JSON.stringify({}),
    });
    await sendFn('🔄 Inscription réinitialisée. Tape */start* pour recommencer.');
    return;
  }
  if (!['confirmer', 'oui', 'ok', 'yes'].includes(t)) {
    await sendFn('Réponds *Confirmer* pour valider ton inscription, ou *Recommencer* pour tout refaire.');
    return;
  }

  // Finaliser
  await finalizeRegistration(member, data, data.geography_id, data.geography_name, sendFn, data.type_ids || []);
}

async function finalizeRegistration(member, data, geoId, geoName, sendFn, typeIds = []) {
  await db.withTransaction(async (client) => {
    // Mettre à jour le profil
    await client.query(
      `UPDATE members SET pseudo=$1, geography_id=$2, registration_step='done',
       registration_data='{}', updated_at=now() WHERE phone_number=$3`,
      [data.pseudo, geoId, member.phone_number]
    );

    // Attribuer les types
    for (const typeId of typeIds) {
      await client.query(
        `INSERT INTO member_type_assignments (member_id, type_id)
         SELECT id, $2 FROM members WHERE phone_number=$1
         ON CONFLICT DO NOTHING`,
        [member.phone_number, typeId]
      );
    }

    // Grade Recrue par défaut
    await client.query(
      `INSERT INTO member_grades (member_id, grade_id)
       SELECT m.id, gd.id FROM members m, grade_definitions gd
       WHERE m.phone_number=$1 AND gd.rank_order=1 AND gd.universe=1
       ON CONFLICT DO NOTHING`,
      [member.phone_number]
    );
  });

  // Récupérer le profil final avec AF-ID
  const final = await db.getMemberByPhone(member.phone_number);

  // Badge "Première Connexion"
  if (final) await db.awardBadge(final.id, 'Première Connexion', 'automatic');

  await sendFn(
    `🎉 *Bienvenue dans l'Empire Afro'o Forever, ${data.pseudo} !*\n\n` +
    `🆔 Ton ID permanent : *${final?.af_id || '—'}*\n` +
    `🪖 Grade de départ : *Recrue*\n` +
    `⭐ XP : *0*\n\n` +
    `Tu es maintenant membre officiel !\n\n` +
    `📱 Commandes utiles :\n` +
    `• */profil* — Voir ton profil\n` +
    `• */xp* — Voir ton XP\n` +
    `• */missions* — Voir tes missions\n` +
    `• */classement* — Top membres\n\n` +
    `🌍 *Empire Afro'o Forever — Que la légende commence !*`
  );

  console.log(`[REGISTER] ✅ Inscription terminée : ${member.phone_number} → ${final?.af_id}`);
}

module.exports = { handleRegistration };
