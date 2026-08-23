import { Badge, Group, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import { PlanPreview } from '../api';
import { Boss, Raider, TIER_LABEL, TIER_RANK } from '../../shared/types';
import { SectionCard, SubHeader } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { ItemTooltip } from './ItemTooltip';

interface Props {
  bosses: Boss[];
  raiders: Raider[];
  plans: Record<number, PlanPreview[]>;
  lockedIn: number[];
  raidId?: string;
}

/** Admin-only: what every raider has pre-picked, before the batch / roll-off is started. */
export function PrePickPreview({ bosses, raiders, plans, lockedIn, raidId }: Props) {
  const [view, setView] = useState<'item' | 'raider'>('item');
  const unresolved = bosses.map((b) => ({ ...b, items: b.items.filter((i) => i.resolved_at == null) })).filter((b) => b.items.length > 0);
  if (unresolved.length === 0) return null;
  const allItems = unresolved.flatMap((b) => b.items);
  const withPicks = new Set(Object.values(plans).flat().map((p) => p.raiderId));
  const locked = new Set(lockedIn);

  const pick = (p: PlanPreview) => {
    const demoted = p.effectiveTier !== p.tier;
    return (
      <Group gap={4} wrap="nowrap" key={p.raiderId} title={demoted ? `Already spent ${TIER_LABEL[p.tier]} — counts as ${TIER_LABEL[p.effectiveTier]}` : undefined}>
        <Text size="xs" fw={600}>
          {p.username}
        </Text>
        <span style={demoted ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
          <TierBadge tier={p.tier} />
        </span>
        {demoted && (
          <>
            <Text size="xs" c="yellow.4">
              →
            </Text>
            <TierBadge tier={p.effectiveTier} />
          </>
        )}
      </Group>
    );
  };

  return (
    <SectionCard
      title="Pre-picks (only you see this)"
      collapsible
      defaultOpen={false}
      right={
        <Group gap="sm">
          <Text size="xs" c="dimmed">
            {withPicks.size} of {raiders.length} have picks · {locked.size} happy
          </Text>
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as 'item' | 'raider')}
            data={[
              { label: 'By item', value: 'item' },
              { label: 'By raider', value: 'raider' },
            ]}
          />
        </Group>
      }
    >
      {view === 'item' ? (
        <Stack gap="sm">
          {unresolved.map((b) => (
            <div key={b.id}>
              <SubHeader icon={b.icon}>{b.name}</SubHeader>
              <Stack gap={6} pl="sm">
                {b.items.map((i) => {
                  const ps = (plans[i.id] ?? []).slice().sort((a, c) => TIER_RANK[c.effectiveTier] - TIER_RANK[a.effectiveTier]);
                  return (
                    <Group key={i.id} gap="sm" wrap="nowrap" align="flex-start">
                      <ItemTooltip raidId={raidId} name={i.name}>
                        <Group gap={6} wrap="nowrap" miw={220}>
                          <Icon src={i.icon} size="sm" />
                          <Text size="sm">{i.name}</Text>
                        </Group>
                      </ItemTooltip>
                      <Group gap="sm">
                        {ps.length === 0 ? (
                          <Text size="xs" c="dimmed">
                            nobody
                          </Text>
                        ) : (
                          ps.map(pick)
                        )}
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            </div>
          ))}
        </Stack>
      ) : (
        <Table verticalSpacing="xs" withRowBorders={false}>
          <Table.Tbody>
            {raiders.map((r) => {
              const mine = allItems
                .map((i) => ({ item: i, p: (plans[i.id] ?? []).find((p) => p.raiderId === r.id) }))
                .filter((x): x is { item: (typeof allItems)[number]; p: PlanPreview } => !!x.p)
                .sort((a, b) => TIER_RANK[b.p.effectiveTier] - TIER_RANK[a.p.effectiveTier]);
              return (
                <Table.Tr key={r.id}>
                  <Table.Td w={160} style={{ verticalAlign: 'top' }}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={600}>
                        {r.username}
                      </Text>
                      {locked.has(r.id) && (
                        <Badge size="xs" variant="light" color="green">
                          ✓
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {mine.length === 0 ? (
                      <Text size="xs" c="red.4">
                        no picks yet
                      </Text>
                    ) : (
                      <Group gap="sm">
                        {mine.map(({ item, p }) => (
                          <Group key={item.id} gap={4} wrap="nowrap">
                            <ItemTooltip raidId={raidId} name={item.name}>
                              <Group gap={4} wrap="nowrap">
                                <Icon src={item.icon} size={16} />
                                <Text size="xs">{item.name}</Text>
                              </Group>
                            </ItemTooltip>
                            <span style={p.effectiveTier !== p.tier ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                              <TierBadge tier={p.tier} />
                            </span>
                            {p.effectiveTier !== p.tier && <TierBadge tier={p.effectiveTier} />}
                          </Group>
                        ))}
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}
    </SectionCard>
  );
}
