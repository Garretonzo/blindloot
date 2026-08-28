import { ActionIcon, Anchor, Autocomplete, Badge, Button, Group, Popover, Stack, Text } from '@mantine/core';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { IconSkull } from '@tabler/icons-react';
import { Boss, canDibs, hasWonCopy, Item, LiveState, Raider, RaidItem, RollEntry, Tier, TIERS, TIER_COLOR, TIER_HINT, TIER_LABEL } from '../../shared/types';
import { rankByTier } from '../../shared/resolve';
import { findBoss, lootFor } from '../../shared/raids';
import { ItemTooltip } from './ItemTooltip';
import { SubHeader } from './SectionCard';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';



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
  onAward?: (itemId: number, raiderId: number | null, tier: Tier | null, force?: boolean) => void;
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

  if (bosses.length === 0) return <EmptyState icon={<IconSkull size={28} />} text="No bosses down yet. Go kill something." />;

  const canPlan = !!me && !!onPlan && bosses.some((b) => b.items.some((i) => i.resolved_at == null && i.id !== currentId));

  return (
    <Stack gap="sm">
      {canPlan && (
        <Text size="xs" c="dimmed">
          <b>Pick your roll on each item below.</b> Nobody sees it; you can change it until the item is resolved.{' '}
          <Anchor component={Link} to="/help" size="xs">
            How it works
          </Anchor>
        </Text>
      )}
      {bosses.map((b) => (
        <div key={b.id}>
          <SubHeader
            icon={b.icon}
            href={raidId ? findBoss(raidId, b.name)?.url : undefined}
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
              const wonColor = i.winner_raider_id != null && i.win_tier ? `var(--mantine-color-${TIER_COLOR[i.win_tier]}-5)` : null;
              return (
                <div
                  key={i.id}
                  style={
                    isCurrent
                      ? { borderLeft: '3px solid var(--mantine-color-teal-5)', marginLeft: -12, paddingLeft: 9, background: 'rgba(18,184,134,0.07)', borderRadius: 4 }
                      : undefined
                  }
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <ItemTooltip raidId={raidId} name={i.name}>
                        <span style={wonColor ? { boxShadow: `0 0 0 2px ${wonColor}`, borderRadius: 4, display: 'inline-flex' } : { display: 'inline-flex' }}>
                          <Icon src={i.icon} size="sm" alt={i.name} />
                        </span>
                      </ItemTooltip>
                      <ItemTooltip raidId={raidId} name={i.name}>
                        <Text size="sm" fw={isCurrent ? 700 : 400} c={isCurrent ? 'teal.2' : resolved ? 'dimmed' : undefined}>
                          {i.name}
                        </Text>
                      </ItemTooltip>
                      {isCurrent && (
                        <Badge size="xs" variant="dot" color="teal" className="blink">
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
                      {resolved && onAward && !isCurrent && (
                        <AwardDetails item={i} raiders={raiders} entries={rolls?.[i.id] ?? []} onAward={onAward} wonCopy={(rid) => hasWonCopy(bosses, rid, i)} />
                      )}
                      {!resolved && !isCurrent && me && onPlan &&
                        (hasWonCopy(bosses, me.id, i) ? (
                          <Text size="xs" c="dimmed" title="One win per item: duplicates of an item you won are auto-passed">
                            You won a copy — auto-passed
                          </Text>
                        ) : (
                          <PlanButtons me={me} plan={plans?.[i.id] ?? null} onPlan={(t) => onPlan(i.id, t)} />
                        ))}
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

export function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Group gap="sm" c="dimmed" py="xs">
      {icon}
      <Text size="sm">{text}</Text>
    </Group>
  );
}

/** Tiny row of four tier buttons for a raider to pre-plan an upcoming roll. */
function PlanButtons({ me, plan, onPlan }: { me: Raider; plan: Tier | null; onPlan: (t: Tier | null) => void }) {
  return (
    <Group gap={2} justify="flex-end">
      {TIERS.map((t) => {
        const disabled = (t === 'need' && me.need_remaining <= 0) || (t === 'dibs' && !canDibs(me));
        const selected = plan === t;
        return (
          <Button
            key={t}
            size="compact-xs"
            color={TIER_COLOR[t]}
            variant={selected ? 'filled' : 'outline'}
            disabled={disabled}
            onClick={() => onPlan(selected ? null : t)}
            title={`Plan ${TIER_LABEL[t]} — ${TIER_HINT[t]}`}
          >
            {selected ? '✓ ' : ''}
            {TIER_LABEL[t]}
          </Button>
        );
      })}
    </Group>
  );
}

/** Admin: expandable top-3-per-tier breakdown with manual award buttons. */
function AwardDetails({
  item,
  raiders,
  entries,
  onAward,
  wonCopy,
}: {
  item: Item;
  raiders: Raider[];
  entries: RollEntry[];
  onAward: (itemId: number, raiderId: number | null, tier: Tier | null, force?: boolean) => void;
  /** One-win-per-copy rule: has this raider already won another item with this name? */
  wonCopy: (raiderId: number) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [giveTo, setGiveTo] = useState<number | null>(null);
  const ranked = rankByTier(entries);
  const order: Tier[] = ['dibs', 'need', 'equip', 'offspec', 'greed']; // passers are never shown
  const others = raiders.filter((r) => !entries.some((e) => e.raiderId === r.id));
  const winner = raiders.find((r) => r.id === item.winner_raider_id) ?? null;

  /**
   * Award at a Need/Dibs tier only after confirming — the server would otherwise demote it if the
   * raider has already won with Need/Dibs elsewhere. Confirming sends force=true. A raider who
   * already won a copy of this item is confirmed (and forced) too — the server rejects otherwise.
   */
  const awardWithCheck = (raiderId: number, t: Tier) => {
    if (wonCopy(raiderId)) {
      if (!confirm('They already won a copy of this item this session. Give anyway?')) return;
      onAward(item.id, raiderId, t, true);
      return;
    }
    if (t === 'need' || t === 'dibs') {
      const ok = confirm(
        `Give as ${TIER_LABEL[t]}? If they've already won with Need/Dibs this session it normally counts one tier lower. OK = count it as ${TIER_LABEL[t]} regardless, Cancel = let the rules decide.`,
      );
      onAward(item.id, raiderId, t, ok);
      return;
    }
    onAward(item.id, raiderId, t);
  };

  const tierRow = (current: Tier | null, onPick: (t: Tier) => void) => (
    <Button.Group>
      {TIERS.filter((t) => t !== 'pass').map((t) => (
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
                {tierRow(item.win_tier, (t) => t !== item.win_tier && awardWithCheck(winner.id, t))}
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
                    {ranked[t].map((e, idx) => {
                      const effective = e.effectiveTier ?? t;
                      const demoted = !!e.ineligible && effective !== t;
                      return (
                        <Group key={e.raiderId} justify="space-between" wrap="nowrap">
                          <Group gap={6} wrap="nowrap">
                            <Text size="xs" fw={e.won ? 700 : 400} c={demoted ? 'dimmed' : undefined} td={demoted ? 'line-through' : undefined}>
                              {idx + 1}. {e.username}
                              {e.roll != null ? ` · ${e.roll}` : ''}
                              {t === 'dibs' ? ` · ilvl ${e.itemLevel}` : ''}
                            </Text>
                            {demoted && (
                              <Group
                                gap={4}
                                wrap="nowrap"
                                title={
                                  effective === 'pass'
                                    ? 'Already won a copy of this item — auto-passes'
                                    : `Has won with Need/Dibs since this roll — now counts as ${TIER_LABEL[effective]}`
                                }
                              >
                                <Text size="xs" c="yellow.4">
                                  → now
                                </Text>
                                <TierBadge tier={effective} />
                              </Group>
                            )}
                          </Group>
                          {item.winner_raider_id !== e.raiderId && (
                            <Button
                              size="compact-xs"
                              variant="default"
                              // A runner-up who already won a copy is given at their rolled tier, after confirm (forced).
                              onClick={() =>
                                wonCopy(e.raiderId) ? awardWithCheck(e.raiderId, effective === 'pass' ? t : effective) : onAward(item.id, e.raiderId, effective)
                              }
                              title={`Give as ${TIER_LABEL[effective === 'pass' ? t : effective]}`}
                            >
                              Give
                            </Button>
                          )}
                        </Group>
                      );
                    })}
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
                      awardWithCheck(giveTo, t);
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
