import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { useIdentity } from '../identity';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Season, Session } from '../../shared/types';

export function Home() {
  const { identity } = useIdentity();
  const [data, setData] = useState<{ seasons: Season[]; sessions: Session[] } | null>(null);
  const [mine, setMine] = useState<Record<number, { hasDibs: boolean }>>({});

  useEffect(() => {
    api.seasons().then(setData).catch(() => setData({ seasons: [], sessions: [] }));
    if (identity) {
      api
        .mySeasons(identity.raiderId)
        .then((rows) => setMine(Object.fromEntries(rows.map((r) => [r.seasonId, r]))))
        .catch(() => {});
    }
  }, [identity]);

  const dibsBadge = (seasonId: number) => {
    if (!identity) return null;
    const s = mine[seasonId];
    if (!s) return <Badge size="xs" variant="light" color="grape">Dibs available</Badge>;
    return s.hasDibs ? (
      <Badge size="xs" variant="light" color="grape">Dibs available</Badge>
    ) : (
      <Badge size="xs" variant="light" color="gray">Dibs used</Badge>
    );
  };

  if (!data) return null;
  if (data.seasons.length === 0) return <Text c="dimmed">No seasons yet.</Text>;

  return (
    <Stack gap="lg">
      {data.seasons.map((season) => (
        <SectionCard key={season.id} title={season.name} right={dibsBadge(season.id)}>
          <Stack gap={4}>
            {data.sessions
              .filter((s) => s.season_id === season.id)
              .map((s) => (
                <Group key={s.id} justify="space-between">
                  <Anchor component={Link} to={`/s/${s.id}`}>
                    {s.name}
                  </Anchor>
                  <Badge variant="light" size="sm" color={s.status === 'closed' ? 'gray' : 'blue'}>
                    {s.status}
                  </Badge>
                </Group>
              ))}
            {data.sessions.every((s) => s.season_id !== season.id) && (
              <Text size="sm" c="dimmed">
                No sessions yet.
              </Text>
            )}
          </Stack>
        </SectionCard>
      ))}
    </Stack>
  );
}
