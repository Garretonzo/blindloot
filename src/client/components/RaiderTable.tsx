import { ActionIcon, Badge, Group, NumberInput, Table, Text, TextInput } from '@mantine/core';
import React, { useEffect, useState } from 'react';
import { Boss, Raider, TIER_LABEL } from '../../shared/types';
import { Icon } from './Icon';
import { EmptyState } from './ItemList';
import { ItemTooltip } from './ItemTooltip';
import { TierBadge } from './TierBadge';
import { IconUsers } from '@tabler/icons-react';

interface Props {
  raiders: Raider[];
  readyIds?: number[];
  /** Raiders who've said they're happy with their pre-picks (shown while the session is open). */
  lockedIn?: number[];
  meId?: number | null;
  editable?: boolean;
  /** Needed for the public view to list each raider's loot won this session. */
  bosses?: Boss[];
  /** The season's boss/loot pool, for item tooltips. */
  raidId?: string;
  onUpdate?: (raiderId: number, patch: { username?: string; itemLevel?: number; dibsRemaining?: number; needRemaining?: number }) => void;
  onRemove?: (raiderId: number) => void;
}

export function RaiderTable({ raiders, readyIds, lockedIn, meId, editable, bosses = [], raidId, onUpdate, onRemove }: Props) {
  if (raiders.length === 0) return <EmptyState icon={<IconUsers size={26} />} text="Nobody here yet." />;
  const ready = new Set(readyIds ?? []);
  const locked = new Set(lockedIn ?? []);
  const picksCell = (id: number) =>
    lockedIn ? (
      <Table.Td w={70}>
        {locked.has(id) ? (
          <Badge size="xs" variant="light" color="green">
            picks ✓
          </Badge>
        ) : (
          <Text size="xs" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
    ) : null;

  const items = bosses.flatMap((b) => b.items);
  const lootCell = (id: number) => {
    const won = items.filter((i) => i.winner_raider_id === id);
    return (
      <Table.Td>
        {won.length === 0 ? (
          <Text size="xs" c="dimmed">
            —
          </Text>
        ) : (
          <Group gap={6}>
            {won.map((i) => (
              <Group key={i.id} gap={4} wrap="nowrap">
                <ItemTooltip raidId={raidId} name={i.name}>
                  <Badge size="sm" variant="light" color="gray" leftSection={<Icon src={i.icon} size={14} />}>
                    {i.name}
                  </Badge>
                </ItemTooltip>
                {/* win_tier is only sent for the viewer's own wins: show how they won it, and their pre-pick. */}
                {i.win_tier && (
                  <span title={i.my_picked_tier ? `You pre-picked ${TIER_LABEL[i.my_picked_tier]}; it counted as ${TIER_LABEL[i.win_tier]}.` : `Won via ${TIER_LABEL[i.win_tier]} (no pre-pick, rolled live).`}>
                    <TierBadge tier={i.win_tier} />
                  </span>
                )}
                {i.win_tier && i.my_picked_tier && i.my_picked_tier !== i.win_tier && (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    picked {TIER_LABEL[i.my_picked_tier]}
                  </Text>
                )}
              </Group>
            ))}
          </Group>
        )}
      </Table.Td>
    );
  };

  if (editable) {
    return (
      <Table verticalSpacing="xs" withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>ilvl</Table.Th>
            <Table.Th>Need</Table.Th>
            <Table.Th>Dibs</Table.Th>
            <Table.Th>Loot this session</Table.Th>
            {lockedIn && <Table.Th>Picks</Table.Th>}
            {readyIds && <Table.Th>Ready</Table.Th>}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {raiders.map((r) => (
            <EditableRow key={r.id} r={r} ready={readyIds ? ready.has(r.id) : undefined} loot={lootCell(r.id)} picks={picksCell(r.id)} onUpdate={onUpdate!} onRemove={onRemove!} />
          ))}
        </Table.Tbody>
      </Table>
    );
  }

  // Public view: name, item level and what they've won — never Need / Dibs state.
  return (
    <Table verticalSpacing="xs" withRowBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>ilvl</Table.Th>
          <Table.Th>Loot this week (this difficulty)</Table.Th>
          {lockedIn && <Table.Th>Picks</Table.Th>}
          {readyIds && <Table.Th>Ready</Table.Th>}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {raiders.map((r) => {
          return (
            <Table.Tr key={r.id} style={r.id === meId ? { background: 'rgba(18,184,134,0.08)' } : undefined}>
              <Table.Td fw={r.id === meId ? 700 : 400} c={r.id === meId ? 'teal.2' : undefined} style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                {r.username}
                {r.id === meId && (
                  <Badge size="xs" variant="light" color="teal" ml={6}>
                    you
                  </Badge>
                )}
              </Table.Td>
              <Table.Td style={{ verticalAlign: 'top' }}>{r.item_level || '—'}</Table.Td>
              {lootCell(r.id)}
              {picksCell(r.id)}
              {readyIds && <Table.Td>{ready.has(r.id) ? '✓' : ''}</Table.Td>}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

/** Remaining-charges stepper, labeled "x / limit". Admins may set any value 0-99, even above the limit. */
function ChargeInput({ value, limit, onChange }: { value: number; limit: number; onChange: (v: number) => void }) {
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

function EditableRow({
  r,
  ready,
  loot,
  picks,
  onUpdate,
  onRemove,
}: {
  r: Raider;
  ready?: boolean;
  loot?: React.ReactNode;
  picks?: React.ReactNode;
  onUpdate: NonNullable<Props['onUpdate']>;
  onRemove: NonNullable<Props['onRemove']>;
}) {
  const [name, setName] = useState(r.username);
  const [ilvl, setIlvl] = useState<number | string>(r.item_level);
  useEffect(() => setName(r.username), [r.username]);
  useEffect(() => setIlvl(r.item_level), [r.item_level]);

  return (
    <Table.Tr>
      <Table.Td>
        <TextInput
          size="xs"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name.trim() && name !== r.username && onUpdate(r.id, { username: name.trim() })}
        />
      </Table.Td>
      <Table.Td>
        <NumberInput
          size="xs"
          w={80}
          value={ilvl}
          min={0}
          allowDecimal={false}
          onChange={setIlvl}
          onBlur={() => typeof ilvl === 'number' && ilvl !== r.item_level && onUpdate(r.id, { itemLevel: ilvl })}
        />
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <ChargeInput value={r.need_remaining} limit={r.need_limit} onChange={(v) => onUpdate(r.id, { needRemaining: v })} />
          {/* {r.need_remaining === 0 && (
            <Badge size="xs" color="yellow" variant="light" title="No Need charges left this session (won with Need or Dibs).">
              used
            </Badge>
          )} */}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <ChargeInput value={r.dibs_remaining} limit={r.dibs_limit} onChange={(v) => onUpdate(r.id, { dibsRemaining: v })} />
          {r.dibs_remaining > 0 && r.need_remaining === 0 && (
            <Badge size="xs" color="yellow" variant="light" title="Dibs charges left (requires available Need charges).">
              locked
            </Badge>
          )}
        </Group>
      </Table.Td>
      {loot}
      {picks}
      {ready !== undefined && <Table.Td>{ready ? '✓' : ''}</Table.Td>}
      <Table.Td>
        <Group justify="flex-end">
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => onRemove(r.id)} title="Remove from session">
            ×
          </ActionIcon>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
