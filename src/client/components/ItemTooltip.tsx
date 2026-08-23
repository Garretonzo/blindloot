import { Anchor, HoverCard, Stack, Text } from '@mantine/core';
import { ReactNode } from 'react';
import { findItem } from '../../shared/raids';

/** WoW quality colours. */
const QUALITY_COLOR: Record<number, string> = {
  0: '#9d9d9d',
  1: '#ffffff',
  2: '#1eff00',
  3: '#0070dd',
  4: '#a335ee',
  5: '#ff8000',
  6: '#e6cc80',
  7: '#e6cc80',
};

/**
 * Hover (or tap) to see the in-game tooltip for a pool item, with a Wowhead link.
 * Custom items (not in the pool) render the child unchanged.
 */
export function ItemTooltip({ raidId, name, children }: { raidId?: string; name: string; children: ReactNode }) {
  const item = findItem(raidId, name);
  if (!item || !item.tooltip?.length) return <>{children}</>;
  return (
    <HoverCard width={300} shadow="lg" openDelay={150} closeDelay={80} withinPortal position="right-start">
      <HoverCard.Target>
        <span style={{ display: 'inline-flex', cursor: 'help' }}>{children}</span>
      </HoverCard.Target>
      <HoverCard.Dropdown
        p="sm"
        style={{ background: '#0b0f19', border: '1px solid #3a4660', borderRadius: 6, fontFamily: 'Verdana, Geneva, sans-serif' }}
      >
        <Stack gap={2}>
          <Text fw={700} fz="sm" style={{ color: QUALITY_COLOR[item.quality ?? 1] ?? '#fff' }}>
            {item.name}
          </Text>
          {item.tooltip.map((line, i) => (
            <Text key={i} fz="xs" c={lineColor(line)} lh={1.25}>
              {line}
            </Text>
          ))}
          {item.url && (
            <Anchor href={item.url} target="_blank" rel="noopener noreferrer" fz="xs" mt={6} c="teal.4">
              Open on Wowhead ↗
            </Anchor>
          )}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** Rough in-game colouring: green for effects/bonuses, yellow for "Use:", gray for flavour/requirements. */
function lineColor(line: string): string {
  if (/^(Equip|Use|Proc|Set):/i.test(line) || /^\+/.test(line) && /(Critical|Haste|Mastery|Versatility|Leech|Speed|Avoidance)/i.test(line)) return '#1eff00';
  if (/^Use:/i.test(line)) return '#ffd100';
  if (/^"/.test(line) || /^Requires|^Binds|^Unique|^Item Level|^Soulbound/i.test(line)) return '#9d9d9d';
  return '#ffffff';
}
