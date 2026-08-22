import { Alert, Badge, Button, Group, NumberInput, Stack, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, Identity } from '../api';
import { useIdentity } from '../identity';
import { SessionDetail, Tier } from '../../shared/types';
import { useSessionSocket } from '../useSessionSocket';
import { ItemList } from '../components/ItemList';
import { RaiderTable } from '../components/RaiderTable';
import { RollPanel } from '../components/RollPanel';
import { BatchResults } from '../components/BatchResults';

export function SessionPage() {
  const sessionId = Number(useParams().sessionId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const { identity } = useIdentity();
  const [plans, setPlans] = useState<Record<number, Tier>>({});
  const me = detail?.raiders.find((r) => r.id === identity?.raiderId) ?? null;
  const { state: live, connected, send } = useSessionSocket(sessionId, me?.id ?? null, identity?.token ?? null);

  const refresh = useCallback(() => {
    api.session(sessionId, identity?.raiderId).then(setDetail).catch(() => setDetail(null));
    if (identity) api.plans(sessionId, identity.raiderId).then(setPlans).catch(() => {});
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
      api.plans(sessionId, identity.raiderId).then(setPlans).catch(() => {});
    }
  };

  if (!detail) return <Text c="dimmed">Loading…</Text>;

  // Unresolved items the viewer has pre-picked Need or Dibs on.
  const unresolved = new Set(detail.bosses.flatMap((b) => b.items).filter((i) => i.resolved_at == null).map((i) => i.id));
  const bigPlans = Object.entries(plans).filter(([id, tier]) => unresolved.has(Number(id)) && (tier === 'need' || tier === 'dibs'));

  return (
    <Stack gap="lg">
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
            <Text size="sm" c="dimmed">
              {me.username}
            </Text>
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

      {live?.batchResults && live.phase === 'open' && <BatchResults results={live.batchResults} bosses={detail.bosses} />}

      {live && (
        <RollPanel
          live={live}
          bosses={detail.bosses}
          raiders={detail.raiders}
          me={me}
          onChoose={(tier) => send({ type: 'choose', tier })}
          onReady={() => send({ type: 'ready' })}
        />
      )}

      <SectionCard title="Loot">
        <Alert variant="light" color="orange" mb="md">
          <b>One Need</b> per week (per difficulty). Win with <b>Dibs</b> and it eats your Need. Win with <b>Need</b> and your Dibs is benched for the
          week. Losing costs nothing, so — just fucking roll.
        </Alert>
        {me && detail.session.status === 'open' && unresolved.size > 0 && (
          <Text size="xs" c="dimmed" mb="sm">
            <b>Your pre-picks are your rolls.</b> When loot's done the officer resolves everything from them in one go
            {live?.shuffle !== false ? ', in random order' : ', in list order'}. No pick, no roll.
          </Text>
        )}
        {me && bigPlans.length > 1 && (
          <Alert variant="light" color="red" mb="md" title={`You're pre-picking Need/Dibs on ${bigPlans.length} items`}>
            You only get one big win. The moment you <b>win</b> one with Need or Dibs, every other Need/Dibs you've pre-picked drops to{' '}
            <b>Equip</b> automatically. Pre-picking several is fine — it just means "whichever comes first"
            {live?.shuffle !== false ? ', and the order is random' : ''}. If one of them matters more, Need that one only.
          </Alert>
        )}
        <ItemList bosses={detail.bosses} raiders={detail.raiders} live={live} me={me} plans={plans} onPlan={me ? setPlan : undefined} />
      </SectionCard>

      <SectionCard title="Raiders" right={<Text size="xs" c="dimmed">{detail.raiders.length} joined</Text>}>
        <RaiderTable
          raiders={detail.raiders}
          bosses={detail.bosses}
          meId={me?.id}
          readyIds={live?.phase === 'ready' ? live.readyRaiderIds : undefined}
        />
      </SectionCard>
    </Stack>
  );
}

function JoinForm({ sessionId, seasonId, me, onJoined }: { sessionId: number; seasonId: number; me: Identity; onJoined: () => void }) {
  const raiderId = me.raiderId;
  const [itemLevel, setItemLevel] = useState<number | string>('');
  const [seasonInfo, setSeasonInfo] = useState<{ lastItemLevel: number; hasDibs: boolean } | null | undefined>(undefined);
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
    <SectionCard title="Join this session">
      <Stack gap="xs">
        <NumberInput label="Your item level. Yes, your real one." value={itemLevel} onChange={setItemLevel} min={0} allowDecimal={false} autoFocus />
        {seasonInfo === null && (
          <Text size="xs" c="dimmed">
            First raid night this season. You start with your Dibs.
          </Text>
        )}
        {seasonInfo && (
          <Text size="xs" c="dimmed">
            Welcome back. Dibs this season: {seasonInfo.hasDibs ? 'available' : 'already used'}.
          </Text>
        )}
        <Button onClick={submit} loading={busy} disabled={itemLevel === ''}>
          I'm in
        </Button>
      </Stack>
    </SectionCard>
  );
}
