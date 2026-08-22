import { Badge, Button, Checkbox, Group, RingProgress, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconCheck, IconDice5, IconTrophy } from '@tabler/icons-react';
import { SectionCard } from './SectionCard';
import { Boss, canDibs, LiveState, Raider, Tier, TIER_COLOR, TIER_HINT, TIER_LABEL } from '../../shared/types';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { useCountdown } from '../useSessionSocket';

export interface AdminControls {
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onSetAutoContinue: (value: boolean) => void;
}

interface Props {
  live: LiveState;
  bosses: Boss[];
  raiders: Raider[];
  me: Raider | null;
  onChoose: (tier: Tier | null) => void;
  onReady: () => void;
  /** When provided (admin page) pause/skip/auto-continue controls render inside the live card. */
  adminControls?: AdminControls;
}

const TIERS: Tier[] = ['greed', 'equip', 'need', 'dibs'];

/** Pause / Resume / Skip / Auto-continue row shown to the admin during both countdowns. */
function AdminBar({ live, controls }: { live: LiveState; controls: AdminControls }) {
  const fresh = live.paused && live.phase === 'item' && live.pausedRemainingMs === live.itemSeconds * 1000;
  const label = !fresh ? 'Resume' : live.currentIndex === 0 ? 'Start countdown' : 'Start next item';
  return (
    <Group justify="space-between" align="center">
      <Group gap="xs">
        {live.paused ? (
          <Button color="green" onClick={controls.onResume}>
            {label}
          </Button>
        ) : (
          <Button color="yellow" onClick={controls.onPause}>
            Pause
          </Button>
        )}
        <Button variant="default" onClick={controls.onSkip}>
          Skip
        </Button>
      </Group>
      <Checkbox
        size="xs"
        label="Auto-continue"
        checked={live.autoContinue}
        onChange={(e) => controls.onSetAutoContinue(e.currentTarget.checked)}
      />
    </Group>
  );
}

export function RollPanel({ live, bosses, raiders, me, onChoose, onReady, adminControls }: Props) {
  const seconds = useCountdown(live.deadline, live.pausedRemainingMs);

  if (live.phase === 'open' || live.phase === 'closed') return null;

  if (live.phase === 'ready') {
    const isReady = me != null && live.readyRaiderIds.includes(me.id);
    return (
      <SectionCard title="Ready check" right={<Text size="xs" c="dimmed">{live.readyRaiderIds.length} / {raiders.length} ready</Text>}>
        <Stack align="center" gap="sm">
          {me && (
            <Button
              size="lg"
              onClick={onReady}
              disabled={isReady}
              color={isReady ? 'green' : 'teal'}
              variant={isReady ? 'light' : 'filled'}
              className={isReady ? undefined : 'pulse'}
              leftSection={isReady ? <IconCheck size={20} /> : undefined}
            >
              {isReady ? 'Ready' : "I'm ready"}
            </Button>
          )}
          {!me && (
            <Text size="sm" c="dimmed">
              Waiting for raiders…
            </Text>
          )}
        </Stack>
      </SectionCard>
    );
  }

  const pausedBadge = live.paused ? (
    <Badge size="xs" color="yellow" variant="filled">
      paused
    </Badge>
  ) : null;

  const itemId = live.itemIds[live.currentIndex];
  const boss = bosses.find((b) => b.items.some((i) => i.id === itemId));
  const item = boss?.items.find((i) => i.id === itemId);
  const total = live.phase === 'item' ? live.itemSeconds : live.resultSeconds;
  // Ring colour: teal → yellow in the last 5 s → red in the last 2 s; yellow while paused; gray for results.
  const ringColor = live.paused ? 'yellow' : live.phase === 'results' ? 'gray' : seconds <= 2 ? 'red' : seconds <= 5 ? 'yellow' : 'teal';
  const header = (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Icon src={item?.icon} size="lg" alt={item?.name} />
        <div>
          <Group gap={6}>
            <Icon src={boss?.icon} size="xs" />
            <Text size="xs" c="dimmed">
              {live.currentIndex + 1} / {live.itemIds.length} · {boss?.name ?? live.lastResult?.bossName}
            </Text>
          </Group>
          <Text fw={700} size="lg">
            {item?.name ?? live.lastResult?.itemName}
          </Text>
        </div>
      </Group>
      <RingProgress
        size={84}
        thickness={6}
        roundCaps
        sections={[{ value: (seconds / total) * 100, color: ringColor }]}
        transitionDuration={100}
        label={
          <Text ta="center" size="xl" fw={700} ff="monospace" c={live.paused ? 'yellow' : ringColor === 'teal' ? undefined : ringColor}>
            {live.paused ? '⏸' : Math.ceil(seconds)}
          </Text>
        }
      />
    </Group>
  );

  if (live.phase === 'item') {
    const mine = me ? live.choices[me.id] : undefined;
    const count = live.choiceCount;
    return (
      <SectionCard
        title="Rolling"
        right={
          <Group gap="xs">
            {pausedBadge}
            <Text size="xs" c="dimmed">
              {count} rolled
            </Text>
          </Group>
        }
      >
        <Stack gap="sm">
          {header}
          {adminControls && <AdminBar live={live} controls={adminControls} />}
          {me ? (
            <SimpleGrid cols={{ base: 2, xs: 4 }}>
              {TIERS.map((t) => {
                const disabled = (t === 'need' && !me.need_available) || (t === 'dibs' && !canDibs(me));
                const selected = mine === t;
                return (
                  <Button
                    key={t}
                    color={TIER_COLOR[t]}
                    variant={selected ? 'filled' : 'outline'}
                    disabled={disabled}
                    title={TIER_HINT[t]}
                    onClick={() => onChoose(selected ? null : t)}
                    size="md"
                    style={selected ? { boxShadow: `0 0 0 3px var(--mantine-color-${TIER_COLOR[t]}-3), 0 0 18px var(--mantine-color-${TIER_COLOR[t]}-6)` } : undefined}
                  >
                    {selected ? '✓ ' : ''}
                    {TIER_LABEL[t]}
                  </Button>
                );
              })}
            </SimpleGrid>
          ) : (
            <Text size="sm" c="dimmed">
              Join the session to roll.
            </Text>
          )}
          {me && (
            <Text size="sm" ta="center" c={mine ? TIER_COLOR[mine] : 'dimmed'} fw={mine ? 600 : 400}>
              {mine ? `You chose: ${TIER_LABEL[mine]}` : 'You have not rolled yet'}
            </Text>
          )}
          {me && (!me.need_available || !canDibs(me)) && (
            <Text size="xs" ta="center" c="dimmed">
              {me.dibs_locked
                ? 'You already won with Need this week (this difficulty). Need and Dibs are locked until next week or difficulty.'
                : !me.need_available && !me.has_dibs
                  ? 'You already won with Dib this week (this difficulty). Need is locked until next week or difficulty.'
                  : !me.need_available
                    ? 'Need already used this session.'
                    : 'Dibs already used this season.'}
            </Text>
          )}
        </Stack>
      </SectionCard>
    );
  }

  // results
  const res = live.lastResult;
  return (
    <SectionCard title="Result" right={pausedBadge}>
      <Stack gap="sm">
        {header}
        {adminControls && <AdminBar live={live} controls={adminControls} />}
        {res && res.winnerId != null ? (
          <Group justify="center" gap="sm" className="pop" key={res.itemId}>
            <IconTrophy size={26} color="var(--mantine-color-yellow-4)" />
            <Text fw={800} fz={24} className="brand">
              {res.winnerName}
            </Text>
            {res.winTier && <TierBadge tier={res.winTier} size="md" />}
          </Group>
        ) : (
          <Group justify="center" gap="xs" className="pop" key={res?.itemId ?? 'none'}>
            <IconDice5 size={22} color="var(--mantine-color-dark-2)" />
            <Text c="dimmed">Nobody rolled. It stays in the bag.</Text>
          </Group>
        )}
        {res && res.entries.length > 0 && (
          <Table verticalSpacing={2} withRowBorders={false}>
            <Table.Tbody>
              {[...res.entries]
                .sort((a, b) => Number(b.won) - Number(a.won))
                .map((e) => (
                  <Table.Tr key={e.raiderId}>
                    <Table.Td fw={e.won ? 700 : 400}>{e.username}</Table.Td>
                    <Table.Td>
                      {e.tier && (
                        <Group gap="xs">
                          <TierBadge tier={e.tier} />
                          {e.tier === 'dibs' && (
                            <Text size="xs" c="dimmed">
                              ilvl {e.itemLevel}
                            </Text>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">{e.roll ?? ''}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </SectionCard>
  );
}
