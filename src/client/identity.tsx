import { Anchor, Button, PasswordInput, Select, Stack, Text } from '@mantine/core';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { api, Identity, loadIdentity, saveIdentity } from './api';
import { GateCard } from './components/SectionCard';
import { loginEndedNotice, usePresence } from './presence';

interface Ctx {
  identity: Identity | null;
  setIdentity: (id: Identity | null) => void;
  /** Raider ids currently logged in anywhere. */
  online: Set<number>;
  logout: () => Promise<void>;
}

const IdentityContext = createContext<Ctx>({ identity: null, setIdentity: () => {}, online: new Set(), logout: async () => {} });

export function IdentityProvider({ children, observe = false }: { children: ReactNode; observe?: boolean }) {
  const [identity, set] = useState<Identity | null>(loadIdentity());
  const setIdentity = (id: Identity | null) => {
    saveIdentity(id);
    set(id);
  };
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const healing = useRef(false);

  /**
   * Our token is no longer valid on the server (restart, reset, expiry). Quietly log in again as
   * the same raider; only fall back to the picker if that name is genuinely taken or gone.
   */
  const heal = async () => {
    const id = identityRef.current;
    if (!id || healing.current) return;
    // Another tab may already hold a newer login for the same raider: adopt it.
    const stored = loadIdentity();
    if (stored && stored.raiderId === id.raiderId && stored.token !== id.token) return set(stored);
    healing.current = true;
    try {
      const fresh = await api.login(id.raiderId, id.token);
      setIdentity(fresh);
      if (fresh.token !== id.token) notifications.show({ color: 'teal', message: 'Reconnected.', autoClose: 3000 });
    } catch (e) {
      setIdentity(null);
      loginEndedNotice(`${(e as Error).message}. Please pick your name again.`);
    } finally {
      healing.current = false;
    }
  };

  const online = usePresence(
    identity,
    {
      onEnded: (reason) => {
        setIdentity(null);
        loginEndedNotice(reason);
      },
      onStale: heal,
    },
    observe,
  );

  // Proactively validate the stored login once per page load, and keep tabs in sync.
  useEffect(() => {
    const id = identityRef.current;
    if (id) {
      api
        .checkLogin(id)
        .then((r) => {
          if (!r.ok) void heal();
        })
        .catch(() => {});
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'loot_identity') return;
      const stored = loadIdentity();
      const cur = identityRef.current;
      if ((stored?.token ?? null) !== (cur?.token ?? null)) set(stored);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    if (identity) await api.logout(identity).catch(() => {});
    setIdentity(null);
  };
  return <IdentityContext.Provider value={{ identity, setIdentity, online, logout }}>{children}</IdentityContext.Provider>;
}

export const useIdentity = () => useContext(IdentityContext);

/** First-visit screen: pick your name from the roster. Names already logged in are greyed out. */
export function NamePrompt() {
  const { setIdentity } = useIdentity();
  const [roster, setRoster] = useState<{ id: number; username: string; has_password: number }[]>([]);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not logged in yet, so no presence socket: poll so the list stays current.
  useEffect(() => {
    const load = () => {
      api.roster().then(setRoster).catch(() => {});
      api.presence().then((p) => setOnline(new Set(p.online))).catch(() => {});
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  const sel = roster.find((r) => String(r.id) === picked);
  const needsSetup = !!sel && !sel.has_password;

  const pick = (v: string | null) => {
    setPicked(v);
    setPassword('');
    setConfirm('');
    setError(null);
  };

  const submit = async () => {
    if (!picked || !password) return;
    if (needsSetup) {
      if (password.length < 4) return setError('At least 4 characters.');
      if (password !== confirm) return setError("Passwords don't match.");
    }
    setBusy(true);
    setError(null);
    try {
      setIdentity(await api.login(Number(picked), undefined, password));
    } catch (e) {
      setError((e as Error).message);
      setPassword('');
      setConfirm('');
      api.presence().then((p) => setOnline(new Set(p.online))).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateCard title="Who the hell are you?" tagline="Blind roll loot distributor.">
        <Stack gap="xs">
          <Select
            label="Your name"
            placeholder={roster.length ? "Pick your name" : "Roster is empty. Poke the loot officer."}
            data={roster.map((r) => ({
              value: String(r.id),
              label: online.has(r.id) ? `${r.username} (logged in)` : r.username,
              disabled: online.has(r.id),
            }))}
            value={picked}
            onChange={pick}
            searchable
            error={!picked ? error : undefined}
            nothingFoundMessage="Not on the roster. Ask an admin to add you"
          />
          {picked && (
            <PasswordInput
              label={needsSetup ? 'Choose a password' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && !needsSetup && submit()}
              error={picked ? error : undefined}
              autoFocus
            />
          )}
          {picked && needsSetup && (
            <>
              <PasswordInput
                label="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <Text size="xs" c="dimmed">
                First login — choose a password (min 4 characters). You'll use it every time you log in. Forgot it later? The loot
                officer can reset it.
              </Text>
            </>
          )}
          <Text size="xs" c="dimmed">
            Greyed-out names are already logged in somewhere. Close that tab (frees up in ~30 s) or nag the loot officer.
          </Text>
          <Button onClick={submit} loading={busy} disabled={!picked || !password || (needsSetup && !confirm)}>
            That's me
          </Button>
          <Text size="xs" c="dimmed" ta="center">
            <Anchor component={Link} to="/help" size="xs">
              How it works
            </Anchor>
          </Text>
        </Stack>
    </GateCard>
  );
}
