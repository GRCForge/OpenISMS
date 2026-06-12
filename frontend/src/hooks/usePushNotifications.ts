import { useState, useEffect } from 'react';
import api from '../lib/api';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer;
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.getRegistration()
        .then(reg => {
          if (!reg) {
            console.error('[Push] Service Worker registration not found.');
            return null;
          }
          return reg.pushManager.getSubscription();
        })
        .then(sub => {
          if (sub) setSubscribed(!!sub);
        })
        .catch(() => {});
    }
  }, []);

  const subscribe = async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        console.error('[Push] Service Worker registration not found.');
        setLoading(false);
        return;
      }
      const { data } = await api.get('/push/vapid-public-key');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.post('/push/subscribe', {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent.slice(0, 200),
      });
      setSubscribed(true);
      setPermission('granted');
    } catch (e) {
      console.error('[Push] subscribe failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        console.error('[Push] Service Worker registration not found.');
        setLoading(false);
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.delete('/push/unsubscribe', { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
    } catch (e) {
      console.error('[Push] unsubscribe failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const requestPermission = async () => {
    if (!supported) return;
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm === 'granted') await subscribe();
  };

  return { supported, permission, subscribed, loading, subscribe, unsubscribe, requestPermission };
}
