import { ActionIcon, Badge, Group, NumberInput, Switch, Table, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Boss, Raider } from '../../shared/types';
import { Icon } from './Icon';
import { EmptyState } from './ItemList';
import { IconUsers } from '@tabler/icons-react';

interface Props {
  raiders: Raider[];
  readyIds?: number[];
  meId?: number | null;
  editable?: boolean;
  /** Needed for the public view to list each raider's loot won this session. */
  bosses?: Boss[];
  onUpdate?: (raiderId: number, patch: { username?: string; itemLevel?: number; hasDibs?: boolean; needAvailable?: boolean }) => void;
  onRemove?: (raiderId: number) => void;
}

export function RaiderTable({ raiders, readyIds, meId, editable, bosses = [], onUpdate, onRemove }: Props) {
  if (raiders.length === 0) return <EmptyState icon={<IconUsers size={26} />} text="Nobody has joined yet." />;
  const ready = new Set(readyIds ?? []);

  if (editable) {
    return (
      <Table verticalSpacing="xs" withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>ilvl</Table.Th>
            <Table.Th>Need</Table.Th>
            <Table.Th>Dibs</Table.Th>
            {readyIds && <Table.Th>Ready</Table.Th>}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {raiders.map((r) => (
            <EditableRow key={r.id} r={r} ready={readyIds ? ready.has(r.id) : undefined} onUpdate={onUpdate!} onRemove={onRemove!} />
          ))}
        </Table.Tbody>
      </Table>
    );
  }

  // Public view: name, item level and what they've won — never Need / Dibs state.
  const items = bosses.flatMap((b) => b.items);
  return (
    <Table verticalSpacing="xs" withRowBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>ilvl</Table.Th>
          <Table.Th>Loot this session</Table.Th>
          {readyIds && <Table.Th>Ready</Table.Th>}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {raiders.map((r) => {
          const won = items.filter((i) => i.winner_raider_id === r.id);
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
              <Table.Td>
                {won.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                ) : (
                  <Group gap={6}>
                    {won.map((i) => (
                      <Badge key={i.id} size="sm" variant="light" color="gray" leftSection={<Icon src={i.icon} size={14} />}>
                        {i.name}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Table.Td>
              {readyIds && <Table.Td>{ready.has(r.id) ? '✓' : ''}</Table.Td>}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function EditableRow({
  r,
  ready,
  onUpdate,
  onRemove,
}: {
  r: Raider;
  ready?: boolean;
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
          <Switch size="xs" color="orange" checked={r.need_available} onChange={(e) => onUpdate(r.id, { needAvailable: e.currentTarget.checked })} />
          {!r.need_available && (
            <Badge size="xs" color="yellow" variant="light" title="Need is gone for this session (won with Need or Dibs).">
              used
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <Switch size="xs" color="grape" checked={r.has_dibs} onChange={(e) => onUpdate(r.id, { hasDibs: e.currentTarget.checked })} />
          {r.dibs_locked && (
            <Badge size="xs" color="yellow" variant="light" title="Locked this session: won with Need. Season Dibs is kept.">
              locked
            </Badge>
          )}
        </Group>
      </Table.Td>
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
