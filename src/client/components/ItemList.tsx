import { ActionIcon, Anchor, Autocomplete, Badge, Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Boss, canDibs, Item, LiveState, Raider, RaidItem, RollEntry, Tier, TIER_COLOR, TIER_LABEL } from '../../shared/types';
import { rankByTier } from '../../shared/resolve';
import { lootFor } from '../../shared/raids';
import { SubHeader } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';

const TIERS: Tier[] = ['greed', 'equip', 'need', 'dibs'];

interface Props {
  bosses: Boss[];
  raiders: Raider[];
  live: LiveState | null;
  /** The season's boss/loot pool (for the add-item autocomplete). */
  raidId?: string;
  /** Admin only: show how each item was won. */
  showTiers?: boolean;
  /** Admin only: recorded rolls per item, enables the runner-up panel. */
  rolls?: Record<number, RollEntry[]>;
  onAward?: (itemId: number, raiderId: number | null, tier: Tier | null) => void;
  /** Raider only: the viewer and their planned tiers per item. */
  me?: Raider | null;
  plans?: Record<number, Tier>;
  onPlan?: (itemId: number, tier: Tier | null) => void;
  onAddItem?: (bossId: number, name: string, icon: string | null) => Promise<void>;
  onDeleteItem?: (itemId: number) => void;
  onDeleteBoss?: (bossId: number) => void;
}

export function ItemList({ bosses, raiders, live, raidId, showTiers, rolls, onAward, me, plans, onPlan, onAddItem, onDeleteItem, onDeleteBoss }: Props) {
  const currentId = live && (live.phase === 'item' || live.phase === 'results') ? live.itemIds[live.currentIndex] : null;
  const name = (id: number | null) => raiders.find((r) => r.id === id)?.username ?? '?';

  if (bosses.length === 0) return <Text c="dimmed">No bosses yet.</Text>;

  return (
    <Stack gap="sm">
      {bosses.map((b) => (
        <div key={b.id}>
          <SubHeader
            icon={b.icon}
            right={
              onDeleteBoss && (
                <ActionIcon variant="subtle" color="gray" size="xs" onClick={() => onDeleteBoss(b.id)} title="Remove boss">
                  ×
                </ActionIcon>
              )
            }
          >
            {b.name}
          </SubHeader>
          <Stack gap={4} pl="sm">
            {b.items.length === 0 && (
              <Text size="sm" c="dimmed">
                No items.
              </Text>
            )}
            {b.items.map((i) => {
              const isCurrent = i.id === currentId;
              const resolved = i.resolved_at != null;
              return (
                <div key={i.id}>
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <Icon src={i.icon} size="sm" alt={i.name} />
                      <Text size="sm" fw={isCurrent ? 700 : 400} c={isCurrent ? undefined : resolved ? 'dimmed' : undefined}>
                        {i.name}
                      </Text>
                      {isCurrent && (
                        <Badge size="xs" variant="filled">
                          now
                        </Badge>
                      )}
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      {i.winner_raider_id != null && (
                        <Text size="sm" c="dimmed">
                          {name(i.winner_raider_id)} {showTiers && i.win_tier && <TierBadge tier={i.win_tier} />}
                        </Text>
                      )}
                      {resolved && i.winner_raider_id == null && (
                        <Text size="xs" c="dimmed">
                          nobody
                        </Text>
                      )}
                      {resolved && onAward && !isCurrent && <AwardDetails item={i} raiders={raiders} entries={rolls?.[i.id] ?? []} onAward={onAward} />}
                      {!resolved && !isCurrent && me && onPlan && <PlanButtons me={me} plan={plans?.[i.id] ?? null} onPlan={(t) => onPlan(i.id, t)} />}
                      {onDeleteItem && !resolved && (
                        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => onDeleteItem(i.id)} title="Remove item">
                          ×
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                </div>
              );
            })}
            {onAddItem && <AddItemInput pool={raidId ? lootFor(raidId, b.name) : []} onAdd={(name, icon) => onAddItem(b.id, name, icon)} />}
          </Stack>
        </div>
      ))}
    </Stack>
  );
}

/** Tiny row of four tier buttons for a raider to pre-plan an upcoming roll. */
function PlanButtons({ me, plan, onPlan }: { me: Raider; plan: Tier | null; onPlan: (t: Tier | null) => void }) {
  return (
    <Button.Group>
      {TIERS.map((t) => {
        const disabled = (t === 'need' && !me.need_available) || (t === 'dibs' && !canDibs(me));
        const selected = plan === t;
        return (
          <Button
            key={t}
            size="compact-xs"
            color={TIER_COLOR[t]}
            variant={selected ? 'filled' : 'outline'}
            disabled={disabled}
            onClick={() => onPlan(selected ? null : t)}
            title={`Plan: ${TIER_LABEL[t]}`}
          >
            {selected ? '✓ ' : ''}
            {TIER_LABEL[t]}
          </Button>
        );
      })}
    </Button.Group>
  );
}

/** Admin: expandable top-3-per-tier breakdown with manual award buttons. */
function AwardDetails({
  item,
  raiders,
  entries,
  onAward,
}: {
  item: Item;
  raiders: Raider[];
  entries: RollEntry[];
  onAward: (itemId: number, raiderId: number | null, tier: Tier | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [giveTo, setGiveTo] = useState<number | null>(null);
  const ranked = rankByTier(entries);
  const order: Tier[] = ['dibs', 'need', 'equip', 'greed'];
  const others = raiders.filter((r) => !entries.some((e) => e.raiderId === r.id));
  const winner = raiders.find((r) => r.id === item.winner_raider_id) ?? null;

  const tierRow = (current: Tier | null, onPick: (t: Tier) => void) => (
    <Button.Group>
      {TIERS.map((t) => (
        <Button
          key={t}
          size="compact-xs"
          color={TIER_COLOR[t]}
          variant={current === t ? 'filled' : 'outline'}
          onClick={() => onPick(t)}
        >
          {TIER_LABEL[t]}
        </Button>
      ))}
    </Button.Group>
  );

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow shadow="md" withinPortal>
      <Popover.Target>
        <Anchor component="button" size="xs" onClick={() => setOpen((o) => !o)}>
          {open ? 'hide' : 'details'}
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown p="sm" miw={300} maw={400}>
          <Stack gap={6}>
            <Text size="xs" fw={700}>
              {item.name}
            </Text>
            {winner && (
              <div>
                <Text size="xs" c="dimmed">
                  Winner: <b>{winner.username}</b> · won via
                </Text>
                {tierRow(item.win_tier, (t) => t !== item.win_tier && onAward(item.id, winner.id, t))}
                <Text size="xs" c="dimmed" mt={2}>
                  Need / Dibs here count exactly like a rolled win.
                </Text>
              </div>
            )}
            <Text size="xs" fw={600} mt={4}>
              Runner-ups
            </Text>
            {order.map((t) =>
              ranked[t].length === 0 ? null : (
                <div key={t}>
                  <TierBadge tier={t} />
                  <Stack gap={2} mt={2}>
                    {ranked[t].map((e, idx) => (
                      <Group key={e.raiderId} justify="space-between" wrap="nowrap">
                        <Text size="xs" fw={e.won ? 700 : 400}>
                          {idx + 1}. {e.username}
                          {e.roll != null ? ` · ${e.roll}` : ''}
                          {t === 'dibs' ? ` · ilvl ${e.itemLevel}` : ''}
                        </Text>
                        {item.winner_raider_id !== e.raiderId && (
                          <Button size="compact-xs" variant="default" onClick={() => onAward(item.id, e.raiderId, t)}>
                            Give
                          </Button>
                        )}
                      </Group>
                    ))}
                  </Stack>
                </div>
              ),
            )}
            {entries.length === 0 && (
              <Text size="xs" c="dimmed">
                Nobody rolled.
              </Text>
            )}
            {others.length > 0 && (
              <div>
                <Group gap={4} mt={4}>
                  <Text size="xs" c="dimmed">
                    Give to someone else:
                  </Text>
                  {others
                    .filter((r) => r.id !== item.winner_raider_id)
                    .map((r) => (
                      <Button
                        key={r.id}
                        size="compact-xs"
                        variant={giveTo === r.id ? 'light' : 'subtle'}
                        onClick={() => setGiveTo(giveTo === r.id ? null : r.id)}
                      >
                        {r.username}
                      </Button>
                    ))}
                </Group>
                {giveTo != null && (
                  <Group gap="xs" mt={4}>
                    <Text size="xs" c="dimmed">
                      as
                    </Text>
                    {tierRow(null, (t) => {
                      onAward(item.id, giveTo, t);
                      setGiveTo(null);
                    })}
                  </Group>
                )}
              </div>
            )}
            {item.winner_raider_id != null && (
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => onAward(item.id, null, null)}>
                Remove winner
              </Button>
            )}
          </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Add an item to an existing boss: pick from the static loot pool or type a custom name. */
function AddItemInput({ pool, onAdd }: { pool: RaidItem[]; onAdd: (name: string, icon: string | null) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const clean = name.trim();
    if (!clean) return;
    const match = pool.find((i) => i.name.toLowerCase() === clean.toLowerCase());
    setBusy(true);
    try {
      await onAdd(match?.name ?? clean, match?.icon ?? null);
      setName('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group gap="xs" wrap="nowrap" mt={4}>
      <Autocomplete
        size="xs"
        style={{ flex: 1 }}
        placeholder={pool.length ? 'Add item from loot pool (or type a name)…' : 'Add item…'}
        data={pool.map((i) => i.name)}
        value={name}
        disabled={busy}
        onChange={setName}
        onOptionSubmit={(v) => setName(v)}
        renderOption={({ option }) => (
          <Group gap="xs" wrap="nowrap">
            <Icon src={pool.find((i) => i.name === option.value)?.icon} size="xs" />
            <Text size="xs">{option.value}</Text>
          </Group>
        )}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        limit={30}
      />
      <ActionIcon variant="default" size="sm" onClick={submit} disabled={!name.trim() || busy} title="Add item">
        +
      </ActionIcon>
    </Group>
  );
}
