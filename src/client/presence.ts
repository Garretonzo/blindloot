import { useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { api, Identity, LOGIN_LOST_EVENT } from './api';

/**
 * Keeps a socket open to the presence service while logged in (that's what "logged in" means
 * server-side) and reports who else is online. Admin pages pass `observe` to watch without
 * a raider identity. When the server ends the login the callback fires.
 */
export function usePresence(identity: Identity | null, onEnded: (reason: string) => void, observe = false) {
  const [online, setOnline] = useState<Set<number>>(new Set());
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!identity && !observe) return;
    let closed = false;
    let attempt = 0;
    let timer: number | undefined;
    let ws: WebSocket | null = null;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = new URL(`${proto}://${location.host}/api/presence/ws`);
      if (identity) {
        url.searchParams.set('raiderId', String(identity.raiderId));
        url.searchParams.set('token', identity.token);
      }
      let opened = false;
      ws = new WebSocket(url);
      ws.onopen = () => {
        opened = true;
        attempt = 0;
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as { type: string; online?: number[] };
        if (msg.type === 'presence') setOnline(new Set(msg.online ?? []));
      };
      ws.onclose = async (ev) => {
        if (closed) return;
        if (ev.code === 4001) return onEndedRef.current('An admin ended your login.');
        if (ev.code === 4000) return onEndedRef.current('Logged out.');
        // Handshake refused (never opened): the server may no longer know this login.
        if (!opened && identity) {
          const { ok } = await api.checkLogin(identity).catch(() => ({ ok: true })); // network issue → keep trying
          if (closed) return;
          if (!ok) return onEndedRef.current('Your login expired — please pick your name again.');
        }
        attempt += 1;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
      };
      ws.onerror = () => ws?.close();
    };

    // Any raider API call answered "not logged in" also ends the login.
    const onLost = () => onEndedRef.current('Your login expired — please pick your name again.');
    window.addEventListener(LOGIN_LOST_EVENT, onLost);

    connect();
    return () => {
      closed = true;
      window.removeEventListener(LOGIN_LOST_EVENT, onLost);
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [identity?.raiderId, identity?.token, observe]);

  return online;
}

export const loginEndedNotice = (reason: string) => notifications.show({ color: 'yellow', message: reason, autoClose: 8000 });
