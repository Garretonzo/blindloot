import { Anchor, Group, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { MyWin } from '../api';
import { SubHeader } from './SectionCard';
import { ItemTooltip } from './ItemTooltip';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';

/**
 * The logged-in raider's wins in one season, newest first. Renders nothing when
 * they haven't won anything there. Each row links to the session it was won in.
 */
export function MyLoot({ wins, raidId }: { wins: MyWin[]; raidId: string }) {
  if (wins.length === 0) return null;
  return (
    <>
      <SubHeader>My Loot</SubHeader>
      <Stack gap={4}>
        {wins.map((w) => (
          <Anchor key={w.itemId} component={Link} to={`/s/${w.sessionId}`} underline="never" c="inherit">
            <Group justify="space-between" px="sm" py={4} wrap="nowrap" style={{ borderRadius: 8 }}>
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Icon src={w.icon} alt={w.name} />
                <div style={{ minWidth: 0 }}>
                  <ItemTooltip raidId={raidId} name={w.name}>
                    <Text size="sm" fw={600} truncate>
                      {w.name}
                    </Text>
                  </ItemTooltip>
                  <Text size="xs" c="dimmed" truncate>
                    {w.bossName} · {w.sessionName} · {new Date(w.resolvedAt).toLocaleDateString()}
                  </Text>
                </div>
              </Group>
              {w.winTier && <TierBadge tier={w.winTier} />}
            </Group>
          </Anchor>
        ))}
      </Stack>
    </>
  );
}
