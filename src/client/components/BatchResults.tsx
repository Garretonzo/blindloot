import { Group, Stack, Table, Text } from '@mantine/core';
import { IconDice5, IconTrophy } from '@tabler/icons-react';
import { Boss, ItemResult } from '../../shared/types';
import { SectionCard } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { ItemTooltip } from './ItemTooltip';

/** Results of an instant batch, in the order the items were rolled. Tiers/rolls are only present for admins. */
export function BatchResults({ results, bosses, raidId }: { results: ItemResult[]; bosses: Boss[]; raidId?: string }) {
  const find = (itemId: number) => {
    const boss = bosses.find((b) => b.items.some((i) => i.id === itemId));
    return { boss, item: boss?.items.find((i) => i.id === itemId) };
  };
  const won = results.filter((r) => r.winnerId != null).length;
  return (
    <SectionCard
      title="Instant batch results"
      right={
        <Text size="xs" c="dimmed">
          {won} of {results.length} items awarded
        </Text>
      }
    >
      <Stack gap={6}>
        {results.map((r, idx) => {
          const { boss, item } = find(r.itemId);
          const showDetail = r.entries.some((e) => e.tier);
          return (
            <div key={r.itemId} style={{ borderBottom: '1px solid var(--mantine-color-dark-5)', paddingBottom: 6 }}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed" w={24} ta="right">
                    {idx + 1}.
                  </Text>
                  <ItemTooltip raidId={raidId} name={r.itemName}>
                    <Icon src={item?.icon} size="sm" />
                  </ItemTooltip>
                  <div>
                    <ItemTooltip raidId={raidId} name={r.itemName}>
                      <Text size="sm" fw={600}>
                        {r.itemName}
                      </Text>
                    </ItemTooltip>
                    <Group gap={4}>
                      <Icon src={boss?.icon} size={14} />
                      <Text size="xs" c="dimmed">
                        {r.bossName}
                      </Text>
                    </Group>
                  </div>
                </Group>
                {r.winnerId != null ? (
                  <Group gap={6} wrap="nowrap">
                    <IconTrophy size={16} color="var(--mantine-color-yellow-4)" />
                    <Text size="sm" fw={700} c="teal.2">
                      {r.winnerName}
                    </Text>
                    {r.winTier && <TierBadge tier={r.winTier} />}
                  </Group>
                ) : (
                  <Group gap={6} wrap="nowrap">
                    <IconDice5 size={16} color="var(--mantine-color-dark-2)" />
                    <Text size="sm" c="dimmed">
                      nobody
                    </Text>
                  </Group>
                )}
              </Group>
              {showDetail && r.entries.length > 0 && (
                <Table verticalSpacing={0} withRowBorders={false} ml={32} w="auto">
                  <Table.Tbody>
                    {r.entries
                      .slice()
                      .sort((a, b) => Number(b.won) - Number(a.won))
                      .map((e) => (
                        <Table.Tr key={e.raiderId}>
                          <Table.Td fz="xs" fw={e.won ? 700 : 400}>
                            {e.username}
                          </Table.Td>
                          <Table.Td>{e.tier && <TierBadge tier={e.tier} />}</Table.Td>
                          <Table.Td fz="xs" c="dimmed">
                            {e.roll ?? ''}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              )}
            </div>
          );
        })}
      </Stack>
    </SectionCard>
  );
}
