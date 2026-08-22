import { Button, Group, MultiSelect, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useMemo, useState } from 'react';
import { raidById } from '../../shared/raids';
import { Icon } from './Icon';

interface Props {
  /** The season's boss/loot pool. */
  raidId: string;
  onSubmit: (name: string, icon: string | null, items: { name: string; icon: string | null }[]) => Promise<void>;
}

export function BossForm({ raidId, onSubmit }: Props) {
  const raid = raidById(raidId);
  const findBoss = (name: string) => raid?.bosses.find((b) => b.name === name) ?? null;
  const [bossName, setBossName] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  /** How many copies of each picked item dropped (the same item can drop more than once). */
  const [qty, setQty] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);

  const boss = bossName ? findBoss(bossName) : null;
  const pool = boss?.items ?? [];
  const iconByName = useMemo(() => new Map(pool.map((i) => [i.name, i.icon])), [pool]);
  const count = (n: string) => Math.max(1, qty[n] ?? 1);
  const total = picked.reduce((s, n) => s + count(n), 0);

  const submit = async () => {
    if (!boss) return;
    const items: { name: string; icon: string | null }[] = [];
    for (const n of picked) for (let k = 0; k < count(n); k++) items.push({ name: n, icon: iconByName.get(n) ?? null });
    for (const n of custom.split(',').map((s) => s.trim()).filter(Boolean)) items.push({ name: n, icon: null });
    setBusy(true);
    try {
      await onSubmit(boss.name, boss.icon, items);
      setBossName(null);
      setPicked([]);
      setQty({});
      setCustom('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap="xs">
      <Select
        label="Boss"
        placeholder="Pick a boss"
        data={(raid?.bosses ?? []).map((b) => ({ value: b.name, label: b.name }))}
        value={bossName}
        onChange={(v) => {
          setBossName(v);
          setPicked([]);
        }}
        leftSection={<Icon src={boss?.icon} size="xs" />}
        renderOption={({ option }) => (
          <Group gap="xs">
            <Icon src={findBoss(option.value)?.icon} size="sm" />
            <Text size="sm">{option.label}</Text>
          </Group>
        )}
        searchable
      />
      <MultiSelect
        label="Items dropped"
        placeholder={boss ? 'Pick from the loot pool' : 'Pick a boss first'}
        disabled={!boss}
        data={pool.map((i) => ({ value: i.name, label: i.name }))}
        value={picked}
        onChange={setPicked}
        renderOption={({ option }) => (
          <Group gap="xs" wrap="nowrap">
            <Icon src={iconByName.get(option.value)} size="sm" />
            <div>
              <Text size="sm">{option.label}</Text>
              {(() => {
                const it = pool.find((i) => i.name === option.value);
                const meta = [it?.type, it?.slot].filter(Boolean).join(' · ');
                return meta ? (
                  <Text size="xs" c="dimmed">
                    {meta}
                  </Text>
                ) : null;
              })()}
            </div>
          </Group>
        )}
        searchable
        hidePickedOptions
        clearable
      />
      {picked.length > 0 && (
        <Stack gap={4}>
          {picked.map((n) => (
            <Group key={n} gap="xs" wrap="nowrap">
              <Icon src={iconByName.get(n)} size="xs" />
              <Text size="sm" style={{ flex: 1 }}>
                {n}
              </Text>
              <Text size="xs" c="dimmed">
                ×
              </Text>
              <NumberInput
                size="xs"
                w={64}
                min={1}
                max={20}
                allowDecimal={false}
                value={count(n)}
                onChange={(v) => setQty({ ...qty, [n]: typeof v === 'number' ? v : 1 })}
                title="How many dropped"
              />
            </Group>
          ))}
        </Stack>
      )}
      <TextInput
        label="Other items (not in the pool)"
        placeholder="Comma-separated, optional — repeat a name to add it twice"
        value={custom}
        onChange={(e) => setCustom(e.currentTarget.value)}
        disabled={!boss}
      />
      <Group>
        <Button size="xs" onClick={submit} loading={busy} disabled={!boss || (picked.length === 0 && !custom.trim())}>
          Add boss{total > 0 ? ` (${total} item${total === 1 ? '' : 's'})` : ''}
        </Button>
      </Group>
    </Stack>
  );
}
