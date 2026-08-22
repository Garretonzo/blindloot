import { Badge, Group, Stack, Table, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { TierBadge } from '../components/TierBadge';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, HistoryData } from '../api';
import { useRequireAdmin } from './Admin';
import { Tier } from '../../shared/types';

export function HistoryPage() {
  const { ok } = useRequireAdmin();
  const seasonId = Number(useParams().seasonId);
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    if (ok) api.admin.history(seasonId).then(setData);
  }, [ok, seasonId]);

  if (!ok || !data) return null;

  return (
    <Stack gap="lg">
      <Title order={3}>Season history</Title>

      <SectionCard title="Raiders">
        <Table verticalSpacing={2} withRowBorders={false}>
          <Table.Tbody>
            {data.raiders.map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td>{r.username}</Table.Td>
                <Table.Td>ilvl {r.item_level}</Table.Td>
                <Table.Td>{r.has_dibs ? <Badge size="xs" variant="light" color="grape">Dibs</Badge> : <Text size="xs" c="dimmed">Dibs used</Text>}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SectionCard>

      {data.sessions.map((s) => (
        <SectionCard key={s.id} title={s.name} right={<Badge size="xs" variant="light">{s.status}</Badge>}>
          <Table verticalSpacing={2} withRowBorders={false}>
            <Table.Tbody>
              {data.items
                .filter((i) => i.session_id === s.id)
                .map((i) => {
                  const rolls = data.rolls.filter((r) => r.item_id === i.item_id);
                  return (
                    <Table.Tr key={i.item_id}>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {i.boss_name}
                        </Text>
                        {i.item_name}
                      </Table.Td>
                      <Table.Td>
                        {i.winner ? (
                          <>
                            <Text span fw={600}>
                              {i.winner}
                            </Text>{' '}
                            <TierBadge tier={i.win_tier as Tier} />
                          </>
                        ) : (
                          <Text size="sm" c="dimmed">
                            {i.win_tier === null && rolls.length === 0 ? '—' : 'nobody'}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6}>
                          {rolls.map((r, idx) => (
                            <Group key={idx} gap={4} wrap="nowrap">
                              <Text size="xs" c="dimmed">
                                {r.username}
                              </Text>
                              <TierBadge tier={r.tier as Tier} />
                              {r.roll_value != null && (
                                <Text size="xs" c="dimmed">
                                  {r.roll_value}
                                </Text>
                              )}
                            </Group>
                          ))}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
            </Table.Tbody>
          </Table>
        </SectionCard>
      ))}
    </Stack>
  );
}
