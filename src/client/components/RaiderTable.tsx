import { Anchor, Badge, Button, Group, NumberInput, Popover, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Boss, Item, Raider, TIER_LABEL } from '../../shared/types';
import { Icon } from './Icon';
import { EmptyState } from './ItemList';
import { ItemTooltip } from './ItemTooltip';
import { RaiderAvatar } from './RaiderAvatar';
import { TierBadge } from './TierBadge';
import { IconCheck, IconUsers } from '@tabler/icons-react';

interface Props {
  raiders: Raider[];
  readyIds?: number[];
  /** Raiders who've said they're happy with their pre-picks (shown while the session is open). */
  lockedIn?: number[];
  meId?: number | null;
  editable?: boolean;
  /** Needed to list each raider's loot won this session. */
  bosses?: Boss[];
  /** The season's boss/loot pool, for item tooltips. */
  raidId?: string;
  onUpdate?: (raiderId: number, patch: { username?: string; itemLevel?: number; dibsRemaining?: number; needRemaining?: number }) => void;
  onRemove?: (raiderId: number) => void;
}

/**
 * Raiders rendered like the Loot card: each raider is a boss-style section — avatar + name
 * header row with a picks-ready checkmark, and their won loot listed below like item rows.
 */
export function RaiderTable({ raiders, readyIds, lockedIn, meId, editable, bosses = [], raidId, onUpdate, onRemove }: Props) {
  if (raiders.length === 0) return <EmptyState icon={<IconUsers size={26} />} text="Nobody here yet." />;
  const ready = new Set(readyIds ?? []);
  const locked = new Set(lockedIn ?? []);
  const wonBy = (id: number) =>
    bosses.flatMap((b) => b.items.filter((i) => i.winner_raider_id === id).map((item) => ({ item, bossName: b.name })));

  return (
    <Stack gap="sm">
      {raiders.map((r) => {
        const isMe = r.id === meId;
        const won = wonBy(r.id);
        // Ready check (staging) takes over the slot; otherwise it reflects lock-in while open.
        const status = readyIds ? { on: ready.has(r.id), onTitle: 'Ready', offTitle: 'Not ready yet' }
          : lockedIn ? { on: locked.has(r.id), onTitle: 'Happy with their picks', offTitle: "Hasn't locked in picks" }
          : null;
        return (
          <div key={r.id} style={isMe ? { background: 'rgba(18,184,134,0.06)', borderRadius: 6, margin: '0 -8px', padding: '2px 8px' } : undefined}>
            <Group gap="xs" wrap="nowrap">
              <RaiderAvatar avatar={r.avatar} username={r.username} size="md" ring />
              <Text size="xs" fw={700} tt="uppercase" c={isMe ? 'teal.2' : 'teal.3'} style={{ letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {r.username}
                <Text span size="xs" fw={400} c="dimmed" tt="none" style={{ letterSpacing: 0 }}>
                  {' '}— {r.item_level || '—'}
                </Text>
              </Text>
              {isMe && (
                <Badge size="xs" variant="light" color="teal">
                  you
                </Badge>
              )}
              <div style={{ flex: 1, borderTop: '1px solid var(--mantine-color-dark-4)' }} />
              {editable && onUpdate && onRemove && <EditRaiderPopover r={r} onUpdate={onUpdate} onRemove={onRemove} />}
              {status && (
                <IconCheck
                  size={16}
                  title={status.on ? status.onTitle : status.offTitle}
                  style={
                    status.on
                      ? { color: 'var(--mantine-color-teal-4)', filter: 'drop-shadow(0 0 4px var(--mantine-color-teal-5))' }
                      : { color: 'var(--mantine-color-dark-3)' }
                  }
                />
              )}
            </Group>
            {won.length > 0 && (
              <Stack gap={4} pl="xl" mt={4}>
                {won.map(({ item, bossName }) => (
                  <LootRow key={item.id} item={item} bossName={bossName} raidId={raidId} />
                ))}
              </Stack>
            )}
          </div>
        );
      })}
    </Stack>
  );
}

/**
 * One won item, styled like a Loot card row. No raider name on the right — the row already
 * sits under the raider. win_tier is present for admins on every win, and for raiders only
 * on their own wins (the server strips it otherwise), so the tier badge shows exactly where
 * it's allowed to.
 */
function LootRow({ item, bossName, raidId }: { item: Item; bossName: string; raidId?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        <ItemTooltip raidId={raidId} name={item.name}>
          <span style={{ display: 'inline-flex' }}>
            <Icon src={item.icon} size="sm" alt={item.name} />
          </span>
        </ItemTooltip>
        <ItemTooltip raidId={raidId} name={item.name}>
          <Text size="sm">{item.name}</Text>
        </ItemTooltip>
        <Text size="xs" c="dimmed">
          {bossName}
        </Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        {item.win_tier && (
          <span
            title={
              item.my_picked_tier
                ? `You pre-picked ${TIER_LABEL[item.my_picked_tier]}; it counted as ${TIER_LABEL[item.win_tier]}.`
                : `Won via ${TIER_LABEL[item.win_tier]}.`
            }
          >
            <TierBadge tier={item.win_tier} />
          </span>
        )}
        {item.win_tier && item.my_picked_tier && item.my_picked_tier !== item.win_tier && (
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            picked {TIER_LABEL[item.my_picked_tier]}
          </Text>
        )}
      </Group>
    </Group>
  );
}

/** Remaining-charges stepper, labeled "x / limit". Admins may set any value 0-99, even above the limit. */
export function ChargeInput({ value, limit, onChange }: { value: number; limit: number; onChange: (v: number) => void }) {
  const [val, setVal] = useState<number | string>(value);
  useEffect(() => setVal(value), [value]);
  return (
    <Group gap={4} wrap="nowrap">
      <NumberInput
        size="xs"
        w={60}
        value={val}
        min={0}
        max={99}
        allowDecimal={false}
        onChange={setVal}
        onBlur={() => typeof val === 'number' && val !== value && onChange(val)}
      />
      <Text size="xs" c="dimmed" title={`Season allowance: ${limit}`}>
        / {limit}
      </Text>
    </Group>
  );
}

/** Admin: per-raider editing (name, ilvl, charges, remove) behind a small popover. */
function EditRaiderPopover({
  r,
  onUpdate,
  onRemove,
}: {
  r: Raider;
  onUpdate: NonNullable<Props['onUpdate']>;
  onRemove: NonNullable<Props['onRemove']>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(r.username);
  const [ilvl, setIlvl] = useState<number | string>(r.item_level);
  useEffect(() => setName(r.username), [r.username]);
  useEffect(() => setIlvl(r.item_level), [r.item_level]);

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow shadow="md" withinPortal>
      <Popover.Target>
        <Anchor component="button" size="xs" c="dimmed" onClick={() => setOpen((o) => !o)}>
          edit
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown p="sm" miw={260}>
        <Stack gap="xs">
          <TextInput
            label="Name"
            size="xs"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={() => name.trim() && name !== r.username && onUpdate(r.id, { username: name.trim() })}
          />
          <NumberInput
            label="ilvl"
            size="xs"
            w={100}
            value={ilvl}
            min={0}
            allowDecimal={false}
            onChange={setIlvl}
            onBlur={() => typeof ilvl === 'number' && ilvl !== r.item_level && onUpdate(r.id, { itemLevel: ilvl })}
          />
          <Group gap="md" wrap="nowrap">
            <div>
              <Text size="xs" fw={500} mb={2}>
                Need
              </Text>
              <ChargeInput value={r.need_remaining} limit={r.need_limit} onChange={(v) => onUpdate(r.id, { needRemaining: v })} />
            </div>
            <div>
              <Text size="xs" fw={500} mb={2}>
                Dibs
              </Text>
              <Group gap={6} wrap="nowrap">
                <ChargeInput value={r.dibs_remaining} limit={r.dibs_limit} onChange={(v) => onUpdate(r.id, { dibsRemaining: v })} />
                {r.dibs_remaining > 0 && r.need_remaining === 0 && (
                  <Badge size="xs" color="yellow" variant="light" title="Dibs charges left (requires available Need charges).">
                    locked
                  </Badge>
                )}
              </Group>
            </div>
          </Group>
          <Button size="compact-xs" variant="subtle" color="red" onClick={() => onRemove(r.id)}>
            Remove from session
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
