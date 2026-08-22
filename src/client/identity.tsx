import { Anchor, Button, Select, Stack, Text } from '@mantine/core';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
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
  const online = usePresence(
    identity,
    (reason) => {
      setIdentity(null);
      loginEndedNotice(reason);
    },
    observe,
  );
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
  const [roster, setRoster] = useState<{ id: number; username: string }[]>([]);
  const [online, setOnline] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
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

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      setIdentity(await api.login(Number(picked)));
    } catch (e) {
      setError((e as Error).message);
      api.presence().then((p) => setOnline(new Set(p.online))).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateCard title="Who are you?" tagline="blind loot distributor">
        <Stack gap="xs">
          <Select
            label="Your name"
            placeholder={roster.length ? 'Pick your name' : 'No raiders on the roster yet'}
            data={roster.map((r) => ({
              value: String(r.id),
              label: online.has(r.id) ? `${r.username} (logged in)` : r.username,
              disabled: online.has(r.id),
            }))}
            value={picked}
            onChange={setPicked}
            searchable
            error={error}
            nothingFoundMessage="Not on the roster. Ask an admin to add you"
          />
          <Text size="xs" c="dimmed">
            Greyed-out names are already logged in somewhere. Closing that tab frees the name after about 30 seconds,
            or an admin can end the login.
          </Text>
          <Button onClick={submit} loading={busy} disabled={!picked}>
            Log in
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
