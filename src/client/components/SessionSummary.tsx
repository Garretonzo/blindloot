import { Badge, Group, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconDice5, IconTrophy } from '@tabler/icons-react';
import { useState } from 'react';
import { RollEntry, SummaryItem, TIER_LABEL } from '../../shared/types';
import { explainResult, rankEntries } from '../../shared/resolve';
import { SectionCard } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { ItemTooltip } from './ItemTooltip';

export const MODE: Record<string, { color: string; label: string }> = {
  batch: { color: 'grape', label: 'batch' },
  live: { color: 'teal', label: 'live' },
  award: { color: 'gray', label: 'awarded' },
};

/** Admin-only: everything that has happened with loot this session, in resolution order. */
export function SessionSummary({ items, raidId }: { items: SummaryItem[]; raidId?: string }) {
  const [filter, setFilter] = useState<'all' | 'big'>('all');
  // Items nobody actually rolled on (and nobody won) are clutter — the header count still tells the story.
  const rolled = items.filter((i) => i.winnerId != null || i.entries.some((e) => e.tier !== 'pass'));
  const shown = filter === 'all' ? rolled : rolled.filter((i) => i.winTier === 'need' || i.winTier === 'dibs');
  const awarded = items.filter((i) => i.winnerId != null).length;

  return (
    <SectionCard
      title="Summary"
      collapsible
      defaultOpen={false}
      right={
        <Group gap="sm">
          <Text size="xs" c="dimmed">
            {items.length} resolved · {awarded} awarded
          </Text>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as 'all' | 'big')}
            data={[
              { label: 'All', value: 'all' },
              { label: 'Need & Dibs', value: 'big' },
            ]}
          />
        </Group>
      }
    >
      <Stack gap="md">
        {shown.length === 0 && (
          <Text size="sm" c="dimmed">
            Nothing to show for this filter.
          </Text>
        )}
        {shown.map((it) => (
          <ItemBlock key={it.itemId} it={it} raidId={raidId} />
        ))}
      </Stack>
    </SectionCard>
  );
}

function ItemBlock({ it, raidId }: { it: SummaryItem; raidId?: string }) {
  // Passers are noise — only actual rollers are shown.
  const ordered = rankEntries(it.entries.filter((e) => e.tier !== 'pass'));
  const showIlvl = it.entries.some((e) => e.tier === 'dibs');
  const mode = it.mode ? MODE[it.mode] : null;
  return (
    <div style={{ borderLeft: '2px solid var(--mantine-color-dark-5)', paddingLeft: 12 }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <Text size="sm" c="dimmed" w={22} ta="right">
            {it.order}.
          </Text>
          <ItemTooltip raidId={raidId} name={it.name}>
            <Icon src={it.icon} size="md" />
          </ItemTooltip>
          <div>
            <Group gap={6}>
              <ItemTooltip raidId={raidId} name={it.name}>
                <Text size="sm" fw={700}>
                  {it.name}
                </Text>
              </ItemTooltip>
              {mode && (
                <Badge size="xs" variant="light" color={mode.color}>
                  {mode.label}
                </Badge>
              )}
            </Group>
            <Group gap={4}>
              <Icon src={it.bossIcon} size={14} />
              <Text size="xs" c="dimmed">
                {it.bossName}
              </Text>
            </Group>
          </div>
        </Group>
        <div style={{ textAlign: 'right' }}>
          {it.winnerId != null ? (
            <Group gap={6} justify="flex-end" wrap="nowrap">
              <IconTrophy size={16} color="var(--mantine-color-yellow-4)" />
              <Text size="sm" fw={700} c="teal.2">
                {it.winnerName}
              </Text>
              {it.winTier && <TierBadge tier={it.winTier} />}
            </Group>
          ) : (
            <Group gap={6} justify="flex-end" wrap="nowrap">
              <IconDice5 size={16} color="var(--mantine-color-dark-2)" />
              <Text size="sm" c="dimmed">
                nobody
              </Text>
            </Group>
          )}
          <Text size="xs" c="dimmed">
            {it.mode === 'award' && it.entries.length === 0 ? 'Awarded by the loot officer.' : explainResult(it.entries)}
          </Text>
        </div>
      </Group>
      {ordered.length > 0 && (
        <Table verticalSpacing={2} withRowBorders={false} mt={6} ml={34} w="auto">
          <Table.Thead>
            <Table.Tr>
              <Table.Th fz="xs" c="dimmed" fw={500}>
                Raider
              </Table.Th>
              <Table.Th fz="xs" c="dimmed" fw={500}>
                Pre-pick → counted as
              </Table.Th>
              <Table.Th fz="xs" c="dimmed" fw={500} ta="right">
                Roll
              </Table.Th>
              {showIlvl && (
                <Table.Th fz="xs" c="dimmed" fw={500} ta="right">
                  ilvl
                </Table.Th>
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ordered.map((e) => (
              <EntryRow key={e.raiderId} e={e} showIlvl={showIlvl} />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </div>
  );
}

function EntryRow({ e, showIlvl }: { e: RollEntry; showIlvl: boolean }) {
  const picked = e.pickedTier ?? null;
  const changed = picked != null && picked !== e.tier;
  return (
    <Table.Tr style={e.won ? { background: 'rgba(18,184,134,0.10)' } : undefined}>
      <Table.Td fz="xs" fw={e.won ? 700 : 400}>
        {e.username}
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {picked == null ? (
            <Text size="xs" c="dimmed" title="No pre-pick; chose during the live countdown">
              —
            </Text>
          ) : (
            <span style={changed ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
              <TierBadge tier={picked} />
            </span>
          )}
          {(changed || picked == null) && e.tier && (
            <>
              {changed && (
                <Text size="xs" c="yellow.4">
                  →
                </Text>
              )}
              <TierBadge tier={e.tier} />
            </>
          )}
          {changed && (
            <Text size="xs" c="dimmed" title={`Pre-picked ${TIER_LABEL[picked!]}, counted as ${TIER_LABEL[e.tier!]}`}>
              {picked === 'need' || picked === 'dibs' ? '(already won big)' : '(changed live)'}
            </Text>
          )}
        </Group>
      </Table.Td>
      <Table.Td fz="xs" ta="right" ff="monospace">
        {e.roll ?? '—'}
      </Table.Td>
      {showIlvl && (
        <Table.Td fz="xs" ta="right" c={e.tier === 'dibs' ? undefined : 'dimmed'}>
          {e.itemLevel || ''}
        </Table.Td>
      )}
    </Table.Tr>
  );
}
