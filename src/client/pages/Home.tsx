import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { IconChevronRight, IconMoodEmpty } from '@tabler/icons-react';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/ItemList';
import { MyLoot } from '../components/MyLoot';
import { useIdentity } from '../identity';
import { raidById } from '../../shared/raids';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, MyWin } from '../api';
import { Season, Session } from '../../shared/types';

export function Home() {
  const { identity } = useIdentity();
  const [data, setData] = useState<{ seasons: Season[]; sessions: Session[] } | null>(null);
  const [mine, setMine] = useState<Record<number, { dibsRemaining: number }>>({});
  const [wins, setWins] = useState<MyWin[]>([]);

  useEffect(() => {
    api.seasons().then(setData).catch(() => setData({ seasons: [], sessions: [] }));
    if (identity) {
      api
        .mySeasons(identity.raiderId)
        .then((rows) => setMine(Object.fromEntries(rows.map((r) => [r.seasonId, r]))))
        .catch(() => {});
      api
        .myWins(identity)
        .then((r) => setWins(r.wins))
        .catch(() => {});
    } else {
      setWins([]);
    }
  }, [identity]);

  const dibsBadge = (seasonId: number) => {
    if (!identity) return null;
    const remaining = mine[seasonId]?.dibsRemaining;
    const used = remaining === 0;
    return (
      <Badge size="xs" variant="light" color={used ? 'gray' : 'grape'}>
        {used ? 'Dibs used' : remaining != null && remaining > 1 ? `Dibs available (${remaining})` : 'Dibs available'}
      </Badge>
    );
  };

  if (!data) return null;
  if (data.seasons.length === 0) return <EmptyState icon={<IconMoodEmpty size={26} />} text="No seasons yet. The loot officer is asleep." />;

  return (
    <Stack gap="lg">
      {data.seasons.map((season) => {
        const raid = raidById(season.raid_id);
        const sessions = data.sessions.filter((s) => s.season_id === season.id);
        return (
          <SectionCard
            key={season.id}
            title={season.name}
            right={
              <Group gap="xs">
                {raid && (
                  <Badge size="xs" variant="outline" color="teal">
                    {raid.name}
                  </Badge>
                )}
                {dibsBadge(season.id)}
              </Group>
            }
          >
            <Stack gap={6}>
              {sessions.map((s) => (
                <Anchor key={s.id} component={Link} to={`/s/${s.id}`} underline="never" c="inherit">
                  <Group
                    justify="space-between"
                    px="sm"
                    py={6}
                    style={{ borderRadius: 8, border: '1px solid var(--mantine-color-dark-5)', background: 'var(--mantine-color-dark-6)' }}
                  >
                    <Text size="sm" fw={600}>
                      {s.name}
                    </Text>
                    <Group gap="xs">
                      <StatusBadge status={s.status} size="xs" />
                      <IconChevronRight size={16} color="var(--mantine-color-teal-4)" />
                    </Group>
                  </Group>
                </Anchor>
              ))}
              {sessions.length === 0 && (
                <Text size="sm" c="dimmed">
                  No sessions yet.
                </Text>
              )}
            </Stack>
            <MyLoot wins={wins.filter((w) => w.seasonId === season.id)} raidId={season.raid_id} />
          </SectionCard>
        );
      })}
    </Stack>
  );
}
