const { Notification } = require('../models');

const sendPush = async (userId, title, body, link, notificationId) => {
  try {
    const webpush = require('web-push');
    const { PushSubscription } = require('../models');
    const { getSetting } = require('./settingsService');
    const raw = await getSetting('vapid_keys');
    if (!raw) return;
    const keys = JSON.parse(raw);
    const vapidContact = process.env.VAPID_EMAIL || process.env.APP_URL || 'https://openisms.local';
    let mailto = 'mailto:admin@openisms.local';
    if (vapidContact) {
      if (vapidContact.startsWith('http')) {
        try {
          mailto = `mailto:admin@${new URL(vapidContact).hostname}`;
        } catch {}
      } else {
        mailto = `mailto:${vapidContact}`;
      }
    }
    webpush.setVapidDetails(mailto, keys.publicKey, keys.privateKey);
    const subs = await PushSubscription.findAll({ where: { user_id: userId } });
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body: body || title, link: link || '/', tag: `openisms-notif-${notificationId || userId}` });
    await Promise.all(subs.map(async sub => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) await sub.destroy();
      }
    }));
  } catch (e) {
    console.error('[Push] send failed:', e.message);
  }
};

// Erstellt eine Benutzer-Benachrichtigung (erscheint in der Glocke) und sendet
// eine Browser-Push-Benachrichtigung falls ein aktives Abonnement vorliegt.
// Selbst-Benachrichtigungen werden uebersprungen.
const notify = async ({ userId, actorId, type = 'assignment', title, content, link }) => {
  if (!userId || Number(userId) === Number(actorId)) return;
  try {
    const created = await Notification.create({ user_id: userId, actor_id: actorId || null, type, title, content: content || null, link: link || null, read: false });
    sendPush(userId, title, content || title, link, created.id).catch(() => {});
  } catch (e) {
    console.error('[Notify] failed:', e.message);
  }
};

module.exports = { notify };
