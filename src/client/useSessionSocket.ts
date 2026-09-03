import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientMessage, LiveState, ServerMessage } from '../shared/types';
import { notifications } from '@mantine/notifications';

export function useSessionSocket(sessionId: number, token: string | null = null, admin = false) {
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: number | undefined;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = new URL(`${proto}://${location.host}/api/sessions/${sessionId}/ws`);
      // Identity comes from the token alone — the server ignores any client-sent raider id.
      if (token) url.searchParams.set('token', token);
      // Only the admin page asks for the admin view; the raider page stays sanitized even for admins.
      if (admin) url.searchParams.set('admin', '1');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        if (msg.type === 'state') setState(msg.state);
        else if (msg.type === 'error') notifications.show({ color: 'red', message: msg.message });
      };
      ws.onclose = () => {
        // A superseded socket (identity changed / StrictMode remount) must not
        // clobber the ref of the socket that replaced it.
        if (wsRef.current !== ws) return;
        setConnected(false);
        wsRef.current = null;
        if (closed) return;
        attempt += 1;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(timer);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [sessionId, token, admin]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { state, connected, send };
}

/** Seconds remaining until `deadline`, ticking every 100ms; frozen at `pausedRemainingMs` while paused. */
export function useCountdown(deadline: number | null, pausedRemainingMs: number | null = null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [deadline]);
  if (deadline == null) return pausedRemainingMs != null ? pausedRemainingMs / 1000 : 0;
  return Math.max(0, (deadline - now) / 1000);
}
