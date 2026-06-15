const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const webpush = require('web-push');
const { authenticate } = require('../middleware/auth');
const { PushSubscription } = require('../models');
const { getSetting, setSetting } = require('../services/settingsService');

let vapidKeysPromise = null;
function getOrCreateVapidKeys() {
  if (!vapidKeysPromise) {
    vapidKeysPromise = (async () => {
      const raw = await getSetting('vapid_keys');
      if (raw) { try { return JSON.parse(raw); } catch {} }
      const keys = webpush.generateVAPIDKeys();
      await setSetting('vapid_keys', keys);
      return keys;
    })().catch(e => { vapidKeysPromise = null; throw e; });
  }
  return vapidKeysPromise;
}

// Returns the VAPID public key so the browser can subscribe
router.get('/vapid-public-key', authenticate, async (req, res) => {
  try {
    const keys = await getOrCreateVapidKeys();
    res.json({ publicKey: keys.publicKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save a new push subscription for the current user
router.post('/subscribe', authenticate, async (req, res) => {
  const { endpoint, p256dh, auth, userAgent } = req.body;
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'Missing fields' });
  try {
    const [sub, created] = await PushSubscription.findOrCreate({
      where: { user_id: req.user.id, endpoint },
      defaults: { p256dh, auth, user_agent: (userAgent || '').slice(0, 255) || null },
    });
    if (!created && (sub.p256dh !== p256dh || sub.auth !== auth)) {
      sub.p256dh = p256dh;
      sub.auth = auth;
      await sub.save();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a push subscription for the current user
router.delete('/unsubscribe', authenticate, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
  try {
    await PushSubscription.destroy({ where: { user_id: req.user.id, endpoint } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
