import { Affix, Badge, Group, Paper, Switch, Text } from '@mantine/core';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { LiveState } from '../../shared/types';

/** Height reserved at the bottom of the page so the pinned bar never covers content. */
export const LOCK_IN_BAR_HEIGHT = 76;

/**
 * The "Happy with your picks?" toggle, pinned to the bottom of the viewport so it's
 * always reachable no matter how long the loot list is. Toggling goes through REST
 * (which works even when the live socket is down); the socket broadcast keeps the
 * shown state and the "x of y" count in sync for everyone.
 */
export function LockInBar({
  sessionId,
  meId,
  raiderCount,
  live,
  connected,
}: {
  sessionId: number;
  meId: number;
  raiderCount: number;
  live: LiveState | null;
  connected: boolean;
}) {
  const wsValue = live?.lockedIn.includes(meId) ?? false;
  // Optimistic value so the switch responds instantly; the next broadcast confirms it.
  const [local, setLocal] = useState(wsValue);
  useEffect(() => setLocal(wsValue), [wsValue]);
  const [busy, setBusy] = useState(false);

  const toggle = async (value: boolean) => {
    setLocal(value);
    setBusy(true);
    try {
      await api.lockIn(sessionId, value);
    } catch {
      setLocal(!value); // didn't stick
    } finally {
      setBusy(false);
    }
  };

  return (
    <Affix position={{ bottom: 0, left: 0, right: 0 }}>
      <Paper
        withBorder
        radius={0}
        px="md"
        py="sm"
        style={{ borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'var(--mantine-color-dark-6)' }}
      >
        <Group justify="space-between" maw={640} mx="auto" wrap="nowrap">
          <div>
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Happy with your picks?
              </Text>
              {!connected && (
                <Badge size="xs" variant="light" color="yellow">
                  reconnecting…
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Tell the officer you're good to go.{live ? ` ${live.lockedIn.length} of ${raiderCount} are.` : ''} It resets if loot
              changes.
            </Text>
          </div>
          <Switch
            size="md"
            color="teal"
            onLabel="YES"
            offLabel="NO"
            checked={local}
            disabled={busy}
            onChange={(e) => toggle(e.currentTarget.checked)}
          />
        </Group>
      </Paper>
    </Affix>
  );
}
