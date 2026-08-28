import { Button, Group, Portal, Stack, Text } from '@mantine/core';
import { IconTrophy } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Raider, SessionDetail, TIER_LABEL } from '../../shared/types';
import { bestWinTier, hypeFor, isFreshReveal, junkFor, winsForRun, wrapFor, JunkItem, WonItem } from '../spectacle';
import { playClick, playFanfare } from '../sfx';
import { useCountdown } from '../useSessionSocket';
import { TierBadge } from './TierBadge';
import { Icon } from './Icon';
import { ItemTooltip } from './ItemTooltip';

type Phase = 'idle' | 'countdown' | 'explosion' | 'present' | 'revealed';

/**
 * The instant-batch spectacle: a fullscreen 5s countdown synced to the server's revealAt,
 * an explosion, and a present the raider clicks 3 times to open, revealing what they won
 * (or a Poor-quality consolation prize). Joined raiders only; missed reveals never replay
 * (the runId ref suppresses reconnect re-delivery, the freshness check kills stale ones).
 */
export function BatchSpectacle({
  reveal,
  me,
  detail,
  raidId,
}: {
  reveal: { runId: number; revealAt: number } | null;
  me: Raider;
  detail: SessionDetail;
  raidId?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [clicks, setClicks] = useState(0);
  const armedRunId = useRef<number | null>(null);

  // Arm once per runId. Mark it seen BEFORE the freshness check so a stale reveal is
  // permanently ignored instead of re-evaluated on every broadcast.
  useEffect(() => {
    if (!reveal || armedRunId.current === reveal.runId) return;
    armedRunId.current = reveal.runId;
    if (!isFreshReveal(reveal, Date.now())) return;
    setClicks(0);
    // A late joiner inside the grace window skips straight to the explosion.
    setPhase(Date.now() < reveal.revealAt ? 'countdown' : 'explosion');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.runId]);

  // Only tick the 100ms countdown clock while we actually count.
  const secs = useCountdown(phase === 'countdown' && reveal ? reveal.revealAt : null);
  useEffect(() => {
    if (phase === 'countdown' && secs <= 0) setPhase('explosion');
  }, [phase, secs]);

  // Explosion -> present once the confetti has made its point.
  useEffect(() => {
    if (phase !== 'explosion') return;
    const t = window.setTimeout(() => setPhase('present'), 1400);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Scroll lock while the stage is up.
  const visible = phase !== 'idle';
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  if (!visible || !reveal) return null;

  // Derived fresh each render: the revision refetch races the reveal, but countdown +
  // explosion + 3 clicks vastly outlast it, and deriving live self-heals a late detail.
  const wins = winsForRun(detail.bosses, reveal.runId, me.id);
  const wrap = wrapFor(bestWinTier(wins));

  const openPresent = () => {
    const n = clicks + 1;
    playClick(n);
    if (n >= 3) {
      playFanfare();
      setPhase('revealed');
    }
    setClicks(n);
  };

  return (
    <Portal>
      <div className={`spectacle-overlay${phase === 'explosion' ? ' spectacle-shake' : ''}`}>
        {phase === 'countdown' && (
          <Stack align="center" gap="xl">
            <Text className="spectacle-hype" ta="center">
              LOOT INCOMING
            </Text>
            <div key={Math.ceil(secs)} className="spectacle-num">
              {Math.max(1, Math.ceil(secs))}
            </div>
            <Text key={`hype-${Math.ceil(secs)}`} className="spectacle-hype pop" ta="center">
              {hypeFor(secs)}
            </Text>
          </Stack>
        )}

        {phase === 'explosion' && (
          <>
            <Confetti />
            <div className="spectacle-num pop">💥</div>
          </>
        )}

        {phase === 'present' && (
          <>
            <Confetti />
            <Stack align="center" gap="lg">
              <div
                role="button"
                aria-label={`Open the present (${clicks} of 3 opens)`}
                key={clicks}
                onClick={openPresent}
                className={`present present-${wrap} wobble-${Math.min(clicks + 1, 3)} pop`}
              >
                {wrap === 'soggy' ? '📦' : '🎁'}
              </div>
              <Text className="spectacle-hype" ta="center">
                {clicks === 0 ? 'A PRESENT! CLICK IT!' : clicks === 1 ? 'KEEP GOING!' : 'ONE MORE!'}
              </Text>
              <Text size="sm" c="dimmed">
                {3 - clicks} click{3 - clicks === 1 ? '' : 's'} to open…
              </Text>
            </Stack>
          </>
        )}

        {phase === 'revealed' && (
          <Stack align="center" gap="lg" className="pop" px="md" maw={460}>
            {wins.length > 0 ? (
              <WinReveal wins={wins} raidId={raidId} />
            ) : (
              <Consolation junk={junkFor(reveal.runId, me.id)} />
            )}
            <Button variant="light" color="teal" size="md" onClick={() => setPhase('idle')}>
              Back to the loot table
            </Button>
          </Stack>
        )}
      </div>
    </Portal>
  );
}

/** ~50 CSS confetti pieces; randomized once per mount. */
function Confetti() {
  const pieces = useMemo(() => {
    const colors = [
      'var(--mantine-color-teal-4)',
      'var(--mantine-color-cyan-4)',
      'var(--mantine-color-grape-4)',
      'var(--mantine-color-yellow-4)',
      'var(--mantine-color-orange-4)',
    ];
    return Array.from({ length: 50 }, (_, i) => ({
      key: i,
      left: `${Math.random() * 100}%`,
      background: colors[i % colors.length],
      width: 6 + Math.random() * 6,
      height: 8 + Math.random() * 8,
      delay: `${Math.random() * 0.4}s`,
      duration: `${1.2 + Math.random() * 1.2}s`,
    }));
  }, []);
  return (
    <>
      {pieces.map((p) => (
        <span
          key={p.key}
          className="confetti-piece"
          style={{ left: p.left, background: p.background, width: p.width, height: p.height, animationDelay: p.delay, animationDuration: p.duration }}
        />
      ))}
    </>
  );
}

/** The loot the raider just won, with tier badges and the pre-pick note. */
function WinReveal({ wins, raidId }: { wins: WonItem[]; raidId?: string }) {
  return (
    <Stack align="center" gap="md">
      <Group gap="sm">
        <IconTrophy size={30} color="var(--mantine-color-yellow-4)" />
        <Text fw={800} fz={26} className="brand">
          {wins.length === 1 ? 'YOU WON LOOT!' : `YOU WON ${wins.length} ITEMS!`}
        </Text>
        <IconTrophy size={30} color="var(--mantine-color-yellow-4)" />
      </Group>
      <Stack gap="sm">
        {wins.map((i) => (
          <Stack key={i.id} gap={2} align="center">
            <Group gap="sm" wrap="nowrap">
              <ItemTooltip raidId={raidId} name={i.name}>
                <span style={{ display: 'inline-flex' }}>
                  <Icon src={i.icon} size="lg" alt={i.name} />
                </span>
              </ItemTooltip>
              <ItemTooltip raidId={raidId} name={i.name}>
                <Text fw={700} size="lg">
                  {i.name}
                </Text>
              </ItemTooltip>
              {i.win_tier && <TierBadge tier={i.win_tier} size="md" />}
            </Group>
            <Text size="xs" c="dimmed">
              {i.bossName}
              {i.win_tier && i.my_picked_tier != null && (
                <>
                  {' '}
                  · You pre-picked {TIER_LABEL[i.my_picked_tier]}
                  {i.win_tier !== i.my_picked_tier ? ` — it counted as ${TIER_LABEL[i.win_tier]}` : ''}
                </>
              )}
            </Text>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

/** The consolation prize. It is not loot. */
function Consolation({ junk }: { junk: JunkItem }) {
  return (
    <Stack align="center" gap={6}>
      <Text size="sm" c="dimmed">
        No loot for you today, but… here:
      </Text>
      <Text fz={80} lh={1}>
        {junk.emoji}
      </Text>
      <Text fw={700} fz={22} className="poor-quality">
        {junk.name}
      </Text>
      <Text size="xs" className="poor-quality">
        Poor · Junk
      </Text>
      <Text size="sm" c="dimmed" fs="italic" ta="center">
        “{junk.flavor}”
      </Text>
    </Stack>
  );
}
