import { Badge, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconDice5, IconTrophy } from '@tabler/icons-react';
import { useState } from 'react';
import { Boss, Item, Raider } from '../../shared/types';
import { BatchGroup, groupBatches } from '../../shared/batches';
import { SectionCard } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { ItemTooltip } from './ItemTooltip';
import { RaiderAvatar } from './RaiderAvatar';
import { LootRow } from './RaiderTable';
import { MODE } from './SessionSummary';

type BatchItem = Item & { bossName: string; bossIcon: string | null };

/**
 * Segmented loot results: one collapsible section per resolution "batch" (an instant batch
 * or one complete live roll-off), most recent first, so a session split across days shows
 * which loot was handed out in which sitting. Rendered on both the raider page (win tiers
 * only on your own wins — the server strips the rest) and the admin page (`admin`: mode
 * badges + every win tier, like the rest of the admin page).
 */
export function BatchResults({
  bosses,
  raiders,
  raidId,
  meId,
  admin,
}: {
  bosses: Boss[];
  raiders: Raider[];
  raidId?: string;
  meId?: number | null;
  admin?: boolean;
}) {
  const rows: BatchItem[] = bosses.flatMap((b) => b.items.map((item) => ({ ...item, bossName: b.name, bossIcon: b.icon })));
  const groups = groupBatches(rows);
  if (groups.length === 0) return null; // no resolved loot yet — no card

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <SectionCard
      title="Batch Results"
      collapsible
      defaultOpen={false}
      right={
        <Text size="xs" c="dimmed">
          {groups.length === 1 ? '1 batch' : `${groups.length} batches`} · {total} item{total === 1 ? '' : 's'}
        </Text>
      }
    >
      <Stack gap="xs">
        {groups.map((g) => (
          <BatchSection key={g.key} group={g} raiders={raiders} raidId={raidId} meId={meId} admin={admin} />
        ))}
      </Stack>
    </SectionCard>
  );
}

const batchLabel = (g: BatchGroup<BatchItem>) => {
  if (g.kind === 'awards') return 'Manually awarded';
  if (g.kind === 'earlier') return 'Earlier results';
  return `Batch — ${new Date(g.runId!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
};

/** One batch: a lightweight collapsible header (mirroring SectionCard's chevron pattern) with an Items/Raiders view toggle. */
function BatchSection({
  group,
  raiders,
  raidId,
  meId,
  admin,
}: {
  group: BatchGroup<BatchItem>;
  raiders: Raider[];
  raidId?: string;
  meId?: number | null;
  admin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'items' | 'raiders'>('items');
  const won = group.items.filter((i) => i.winner_raider_id != null).length;
  return (
    <div style={{ borderLeft: '2px solid var(--mantine-color-dark-5)', paddingLeft: 12 }}>
      <Group
        justify="space-between"
        wrap="nowrap"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen((o) => !o)}
      >
        <Group gap={6} wrap="nowrap">
          {open ? <IconChevronDown size={14} color="var(--mantine-color-teal-3)" /> : <IconChevronRight size={14} color="var(--mantine-color-teal-3)" />}
          <Text size="xs" fw={700} tt="uppercase" c="teal.3" style={{ letterSpacing: '0.06em' }}>
            {batchLabel(group)}
          </Text>
        </Group>
        {/* Stop clicks on header controls from toggling the section. */}
        <Group gap="sm" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {group.items.length} item{group.items.length === 1 ? '' : 's'} · {won} won
          </Text>
          {open && (
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => setView(v as 'items' | 'raiders')}
              data={[
                { label: 'Items', value: 'items' },
                { label: 'Raiders', value: 'raiders' },
              ]}
            />
          )}
        </Group>
      </Group>
      {open && (
        <div style={{ paddingTop: 6 }}>
          {view === 'items' ? (
            <ByItem items={group.items} raiders={raiders} raidId={raidId} admin={admin} />
          ) : (
            <ByRaider items={group.items} raiders={raiders} raidId={raidId} meId={meId} />
          )}
        </div>
      )}
    </div>
  );
}

/** The batch's items in the order they were rolled, SessionSummary-row style. */
function ByItem({ items, raiders, raidId, admin }: { items: BatchItem[]; raiders: Raider[]; raidId?: string; admin?: boolean }) {
  const name = (id: number | null) => raiders.find((r) => r.id === id)?.username ?? '?';
  return (
    <Stack gap={4}>
      {items.map((i, idx) => {
        const mode = admin && i.resolved_mode ? MODE[i.resolved_mode] : null;
        return (
          <Group key={i.id} justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" w={18} ta="right">
                {idx + 1}.
              </Text>
              <ItemTooltip raidId={raidId} name={i.name}>
                <span style={{ display: 'inline-flex' }}>
                  <Icon src={i.icon} size="sm" alt={i.name} />
                </span>
              </ItemTooltip>
              <ItemTooltip raidId={raidId} name={i.name}>
                <Text size="sm">{i.name}</Text>
              </ItemTooltip>
              {mode && (
                <Badge size="xs" variant="light" color={mode.color}>
                  {mode.label}
                </Badge>
              )}
              <Text size="xs" c="dimmed">
                {i.bossName}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              {i.winner_raider_id != null ? (
                <>
                  <IconTrophy size={14} color="var(--mantine-color-yellow-4)" />
                  <Text size="sm" c="teal.2" style={{ whiteSpace: 'nowrap' }}>
                    {name(i.winner_raider_id)}
                  </Text>
                  {i.win_tier && <TierBadge tier={i.win_tier} />}
                </>
              ) : (
                <>
                  <IconDice5 size={14} color="var(--mantine-color-dark-2)" />
                  <Text size="xs" c="dimmed">
                    nobody
                  </Text>
                </>
              )}
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}

/** The batch's loot grouped under the raiders who won it, RaiderTable style. */
function ByRaider({ items, raiders, raidId, meId }: { items: BatchItem[]; raiders: Raider[]; raidId?: string; meId?: number | null }) {
  const unwon = items.filter((i) => i.winner_raider_id == null).length;
  const withWins = raiders
    .map((r) => ({ r, won: items.filter((i) => i.winner_raider_id === r.id) }))
    .filter((x) => x.won.length > 0);
  return (
    <Stack gap="sm">
      {withWins.map(({ r, won }) => {
        const isMe = r.id === meId;
        return (
          <div key={r.id}>
            {/* my="xs" mirrors RaiderTable: air below the name before the loot rows, and between
                one raider's last item and the next raider's header. */}
            <Group gap="xs" wrap="nowrap" my="xs">
              <RaiderAvatar avatar={r.avatar} username={r.username} size="sm" ring />
              <Text size="xs" fw={700} tt="uppercase" c={isMe ? 'teal.2' : 'teal.3'} style={{ letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {r.username}
              </Text>
              {isMe && (
                <Badge size="xs" variant="light" color="teal">
                  you
                </Badge>
              )}
              <div style={{ flex: 1, borderTop: '1px solid var(--mantine-color-dark-4)' }} />
            </Group>
            <Stack gap={4} pl="sm">
              {won.map((item) => (
                <LootRow key={item.id} item={item} bossName={item.bossName} raidId={raidId} />
              ))}
            </Stack>
          </div>
        );
      })}
      {unwon > 0 && (
        <Text size="xs" c="dimmed">
          {unwon} item{unwon === 1 ? '' : 's'} won by nobody.
        </Text>
      )}
    </Stack>
  );
}
