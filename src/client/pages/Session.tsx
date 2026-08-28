import { Alert, Badge, Button, Group, NumberInput, Stack, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Identity } from '../api';
import { useIdentity } from '../identity';
import { SessionDetail, Tier } from '../../shared/types';
import { useSessionSocket } from '../useSessionSocket';
import { ItemList } from '../components/ItemList';
import { RaiderTable } from '../components/RaiderTable';
import { RollPanel } from '../components/RollPanel';
import { LockInBar, LOCK_IN_BAR_HEIGHT } from '../components/LockInBar';
import { BatchResults } from '../components/BatchResults';
import { BatchSpectacle } from '../components/BatchSpectacle';

export function SessionPage() {
  const sessionId = Number(useParams().sessionId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const { identity } = useIdentity();
  const [plans, setPlans] = useState<Record<number, Tier>>({});
  const me = detail?.raiders.find((r) => r.id === identity?.raiderId) ?? null;
  const { state: live, connected, send } = useSessionSocket(sessionId, me?.id ?? null, identity?.token ?? null);

  // Sequence refreshes so a slow earlier response can't overwrite a newer one
  // (that race used to blank out the viewer's own Dibs/Need counts).
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const n = ++seq.current;
    api.session(sessionId).then((d) => { if (seq.current === n) setDetail(d); }).catch(() => {});
    if (identity) api.plans(sessionId).then((p) => { if (seq.current === n) setPlans(p); }).catch(() => {});
  }, [sessionId, identity]);

  useEffect(refresh, [refresh, live?.revision]);

  const setPlan = async (itemId: number, tier: Tier | null) => {
    if (!identity) return;
    setPlans((p) => {
      const next = { ...p };
      if (tier) next[itemId] = tier;
      else delete next[itemId];
      return next;
    });
    try {
      await api.setPlan(sessionId, identity, itemId, tier);
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
      api.plans(sessionId).then(setPlans).catch(() => {});
    }
  };

  if (!detail) return <Text c="dimmed">Loading…</Text>;

  // Unresolved items the viewer has pre-picked Need or Dibs on.
  const unresolved = new Set(detail.bosses.flatMap((b) => b.items).filter((i) => i.resolved_at == null).map((i) => i.id));
  const bigPlans = Object.entries(plans).filter(([id, tier]) => unresolved.has(Number(id)) && (tier === 'need' || tier === 'dibs'));
  // Pinned to the viewport bottom — visible regardless of scrolling, and no longer dependent on the live socket.
  const showLockInBar = !!me && detail.session.status === 'open' && unresolved.size > 0;

  return (
    <Stack gap="lg" pb={showLockInBar ? LOCK_IN_BAR_HEIGHT : undefined}>
      {/* Fullscreen instant-batch countdown + present reveal; renders via a Portal. Joined raiders only. */}
      {me && <BatchSpectacle reveal={live?.batchReveal ?? null} me={me} detail={detail} raidId={detail.season.raid_id} />}

      <Group justify="space-between">
        <div>
          <Text size="xs" c="dimmed">
            {detail.season.name}
          </Text>
          <Title order={3}>{detail.session.name}</Title>
        </div>
        <Group gap="xs">
          <Badge variant="light" color={connected ? 'green' : 'red'} size="sm">
            {connected ? 'live' : 'offline'}
          </Badge>
          {me && (
            <>
              <Badge
                size="sm"
                variant="light"
                color={me.need_remaining > 0 ? 'orange' : 'gray'}
                title={`Need charges left this session (a Dibs win also spends one). Your raid leader allows ${me.need_limit} per session.`}
              >
                Need {me.need_remaining}/{me.need_limit}
              </Badge>
              <Badge
                size="sm"
                variant="light"
                color={me.dibs_remaining > 0 && me.need_remaining > 0 ? 'grape' : 'gray'}
                title={
                  me.dibs_remaining > 0 && me.need_remaining === 0
                    ? `Dibs charges left this season (but Dibs require an available Need charge, so it's locked right now).`
                    : `Dibs charges left this season. Your raid leader allows ${me.dibs_limit} per season.`
                }
              >
                Dibs {me.dibs_remaining}/{me.dibs_limit}
              </Badge>
              <Text size="sm" c="dimmed">
                {me.username}
              </Text>
            </>
          )}
        </Group>
      </Group>

      {!me && identity && detail.session.status === 'open' && (
        <JoinForm sessionId={sessionId} seasonId={detail.season.id} me={identity} onJoined={refresh} />
      )}
      {!me && detail.session.status !== 'open' && (
        <Text size="sm" c="dimmed">
          This session is no longer accepting raiders.
        </Text>
      )}

      {live && (
        <RollPanel
          live={live}
          bosses={detail.bosses}
          raiders={detail.raiders}
          raidId={detail.season.raid_id}
          me={me}
          onChoose={(tier) => send({ type: 'choose', tier })}
          onReady={() => send({ type: 'ready' })}
        />
      )}

      <BatchResults bosses={detail.bosses} raiders={detail.raiders} raidId={detail.season.raid_id} meId={me?.id} />

      <SectionCard title="Loot" collapsible>
        <Alert variant="light" color="orange" mb="md">
          <b>{detail.season.need_per_session === 1 ? 'One Need win' : `${detail.season.need_per_session} Need wins`}</b> per week (per
          difficulty), <b>{detail.season.dibs_per_season === 1 ? 'one Dibs' : `${detail.season.dibs_per_season} Dibs`}</b> per season. 
          A Dibs win also spends a Need charge, and Dibs is locked whenever you're out of Need charges. 
          Need and Dibs are only spent when you <b>win</b>. Losing costs nothing, so... just fucking roll.
        </Alert>
        {me && detail.session.status === 'open' && unresolved.size > 0 && (
          <Text size="xs" c="dimmed" mb="sm">
            <b>Your pre-picks are your rolls.</b> When loot's done the officer resolves everything from them in one go
            {live?.shuffle !== false ? '' : ', in list order'}. No pick, no roll.
          </Text>
        )}
        {me && bigPlans.length > (me.need_remaining || 1) && (
          <Alert variant="light" color="red" mb="md" title={`You're pre-picking Need/Dibs on ${bigPlans.length} items`}>
            Every Need or Dibs <b>win</b> spends a Need charge
            and you have {me.need_remaining} remaining.
            Once you're out, every other Need/Dibs you've pre-picked drops to <b>Equip</b> automatically. Pre-picking more is fine. It just means "whichever
            comes first". And since the item roll-off order is pseudo-random, you don't get to choose which one goes first.
            If some matter more, maybe think about Needing those only. The risk is yours.
          </Alert>
        )}
        <ItemList bosses={detail.bosses} raiders={detail.raiders} live={live} raidId={detail.season.raid_id} me={me} plans={plans} onPlan={me ? setPlan : undefined} />
      </SectionCard>

      <SectionCard title="Raiders" collapsible right={<Text size="xs" c="dimmed">{detail.raiders.length} joined</Text>}>
        <RaiderTable
          raiders={detail.raiders}
          bosses={detail.bosses}
          raidId={detail.season.raid_id}
          meId={me?.id}
          readyIds={live?.phase === 'ready' ? live.readyRaiderIds : undefined}
          lockedIn={live?.phase === 'open' ? live.lockedIn : undefined}
        />
      </SectionCard>

      {showLockInBar && me && (
        <LockInBar sessionId={sessionId} meId={me.id} raiderCount={detail.raiders.length} live={live} connected={connected} />
      )}
    </Stack>
  );
}

function JoinForm({ sessionId, seasonId, me, onJoined }: { sessionId: number; seasonId: number; me: Identity; onJoined: () => void }) {
  const raiderId = me.raiderId;
  const [itemLevel, setItemLevel] = useState<number | string>('');
  const [seasonInfo, setSeasonInfo] = useState<{ lastItemLevel: number; dibsRemaining: number } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Pre-fill from this raider's record for the season (if they've raided this season before).
  useEffect(() => {
    api
      .mySeasons(raiderId)
      .then((rows) => {
        const mine = rows.find((r) => r.seasonId === seasonId) ?? null;
        setSeasonInfo(mine);
        if (mine && mine.lastItemLevel > 0) setItemLevel(mine.lastItemLevel);
      })
      .catch(() => setSeasonInfo(null));
  }, [raiderId, seasonId]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.join(sessionId, me, Number(itemLevel) || 0);
      onJoined();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Join this session" collapsible>
      <Stack gap="xs">
        <NumberInput label="Your highest item level (character panel mouse-over tooltip)." value={itemLevel} onChange={setItemLevel} min={0} allowDecimal={false} autoFocus />
        {seasonInfo === null && (
          <Text size="xs" c="dimmed">
            First raid night this season. You start with full Dibs charges.
          </Text>
        )}
        {seasonInfo && (
          <Text size="xs" c="dimmed">
            Welcome back. Dibs left this season: {seasonInfo.dibsRemaining > 0 ? seasonInfo.dibsRemaining : 'none'}.
          </Text>
        )}
        <Button onClick={submit} loading={busy} disabled={itemLevel === ''}>
          I'm in
        </Button>
      </Stack>
    </SectionCard>
  );
}
