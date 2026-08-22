import { Button, PasswordInput, Stack } from '@mantine/core';
import { GateCard } from '../components/SectionCard';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export function AdminLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.admin.login(password);
      nav('/admin', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateCard title="Admin login" tagline="Loot officer tools">
      <Stack gap="xs">
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          error={error}
          autoFocus
        />
        <Button onClick={submit} loading={busy}>
          Log in
        </Button>
      </Stack>
    </GateCard>
  );
}
