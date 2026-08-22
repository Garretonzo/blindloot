import { Button, PasswordInput, Stack, Text } from '@mantine/core';
import { ReactNode, useEffect, useState } from 'react';
import { api } from './api';
import { SectionCard } from './components/SectionCard';

/**
 * Site-wide password. Shown before anything else (including the name picker) until the
 * browser has the site cookie. Admin pages have their own login and bypass this.
 */
export function SiteGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.site
      .me()
      .then((r) => setOk(r.ok))
      .catch(() => setOk(false));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.site.login(password);
      setOk(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (ok === null) return null;
  if (ok) return <>{children}</>;

  return (
    <div style={{ maxWidth: 360, margin: '0 auto' }}>
      <SectionCard title="Raid loot">
        <Stack gap="xs">
          <PasswordInput
            label="Site password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            error={error}
            autoFocus
          />
          <Text size="xs" c="dimmed">
            Ask your raid lead for the password. You only need to enter it once per browser.
          </Text>
          <Button onClick={submit} loading={busy} disabled={!password}>
            Enter
          </Button>
        </Stack>
      </SectionCard>
    </div>
  );
}
