import { api } from './api';

/**
 * Registering this browser for notifications.
 *
 * Two things are worth waking somebody for: a builder finished, and their hold
 * was raided. The permission prompt is only ever raised from a real tap in
 * settings — asking on page load is how a game gets its notifications blocked
 * before it has earned any.
 */

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'off' | 'on';

function supported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/**
 * VAPID keys travel as base64url and the browser wants raw bytes.
 *
 * Returns an ArrayBuffer rather than a Uint8Array: a typed array over a
 * possibly-shared buffer is not assignable to BufferSource, and the underlying
 * buffer is what PushManager wants anyway.
 */
function decodeKey(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const { available } = await api.pushKey();
    if (!available) return 'unavailable';
    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    return existing ? 'on' : 'off';
  } catch {
    return 'unavailable';
  }
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';

  const { available, key } = await api.pushKey();
  if (!available || !key) return 'unavailable';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    // Chrome refuses a subscription that is not user-visible, and rightly so.
    userVisibleOnly: true,
    applicationServerKey: decodeKey(key),
  });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'off';

  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  }
  return 'off';
}
