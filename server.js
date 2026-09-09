'use strict';
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');

const app = express();
let _qrData = null;
let _isReady = false;
let _botNumber = null;

// ── État QR partagé avec bot.js ───────────────────────────────
function setQR(data) { _qrData = data; _isReady = false; }
function setReady(number) { _isReady = true; _qrData = null; _botNumber = number; }

// ── Page d'accueil / QR code ──────────────────────────────────
app.get('/', async (req, res) => {
  if (_isReady) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Afro'o Forever Bot</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: #fff;
                 display: flex; align-items: center; justify-content: center;
                 min-height: 100vh; margin: 0; text-align: center; }
          .card { background: #111; border: 1px solid #222; border-radius: 16px;
                  padding: 40px; max-width: 480px; }
          h1 { color: #25D366; margin-bottom: 8px; }
          .status { background: #1a3a1a; border: 1px solid #25D366;
                    border-radius: 8px; padding: 12px 24px; margin: 20px 0;
                    font-size: 1.1em; }
          .number { color: #aaa; font-size: 0.9em; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🌍 Afro'o Forever</h1>
          <div class="status">✅ Bot connecté et opérationnel</div>
          <div class="number">Numéro : ${_botNumber || '—'}</div>
          <p style="color:#555;margin-top:24px;font-size:0.85em">
            Infrastructure communautaire Afro'o Forever
          </p>
        </div>
      </body>
      </html>
    `);
  }

  if (!_qrData) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Afro'o Forever Bot</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: #fff;
                 display: flex; align-items: center; justify-content: center;
                 min-height: 100vh; margin: 0; text-align: center; }
          .card { background: #111; border: 1px solid #222; border-radius: 16px; padding: 40px; }
        </style>
        <meta http-equiv="refresh" content="5">
      </head>
      <body>
        <div class="card">
          <h1>🌍 Afro'o Forever</h1>
          <p>⏳ Démarrage en cours…</p>
          <p style="color:#555;font-size:0.85em">Cette page se rafraîchit automatiquement.</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const qrImage = await QRCode.toDataURL(_qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.send(`
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Afro'o Forever — Scanner QR</title>
        <style>
          body { font-family: sans-serif; background: #0a0a0a; color: #fff;
                 display: flex; align-items: center; justify-content: center;
                 min-height: 100vh; margin: 0; text-align: center; }
          .card { background: #111; border: 1px solid #333; border-radius: 16px;
                  padding: 40px; max-width: 420px; }
          h1 { color: #25D366; margin-bottom: 4px; }
          .qr { background: white; display: inline-block;
                padding: 16px; border-radius: 12px; margin: 24px 0; }
          .qr img { display: block; width: 280px; height: 280px; }
          .steps { text-align: left; background: #1a1a1a; border-radius: 8px;
                   padding: 16px; font-size: 0.9em; line-height: 1.8; }
          .steps span { color: #25D366; font-weight: bold; }
        </style>
        <meta http-equiv="refresh" content="30">
      </head>
      <body>
        <div class="card">
          <h1>🌍 Afro'o Forever</h1>
          <p style="color:#aaa">Scanne ce QR code pour connecter le bot</p>
          <div class="qr">
            <img src="${qrImage}" alt="QR Code WhatsApp">
          </div>
          <div class="steps">
            <span>1.</span> Ouvre WhatsApp sur ton téléphone<br>
            <span>2.</span> Paramètres → Appareils liés<br>
            <span>3.</span> Relier un appareil<br>
            <span>4.</span> Scanne ce QR code<br>
          </div>
          <p style="color:#555;font-size:0.8em;margin-top:16px">
            Page rafraîchie toutes les 30s
          </p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Erreur génération QR code : ' + err.message);
  }
});

// ── /health — Railway l'utilise pour vérifier que le process tourne
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    botReady: _isReady,
    qrAvailable: !!_qrData,
    botNumber: _botNumber,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── Démarrage ─────────────────────────────────────────────────
function start() {
  const port = config.PORT;
  app.listen(port, () => {
    console.log(`[BOOT] Serveur HTTP démarré sur le port ${port}`);
  });
}

module.exports = { start, setQR, setReady };
