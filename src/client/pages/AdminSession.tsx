import { Anchor, Badge, Button, Checkbox, Divider, Group, NumberInput, Select, Stack, Text, Title } from '@mantine/core';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '@mantine/hooks';
import { Link, useParams } from 'react-router-dom';
import { api, PlanPreviewView, RosterRaider } from '../api';
import { PrePickPreview } from '../components/PrePickPreview';
import { RollEntry, SessionDetail, SummaryItem, TIER_LABEL } from '../../shared/types';
import { SessionSummary } from '../components/SessionSummary';
import { useSessionSocket } from '../useSessionSocket';
import { useRevisionedFetch } from '../useRevisionedFetch';
import { summarize } from '../summary';
import { useRequireAdmin } from './Admin';
import { ItemList } from '../components/ItemList';
import { RaiderTable } from '../components/RaiderTable';
import { RollPanel } from '../components/RollPanel';
import { BossForm } from '../components/BossForm';
import { BatchResults } from '../components/BatchResults';

/** Add a raider from the site-wide roster to this session, with this session's item level. */
function AddRaiderRow({ inSession, onAdd }: { inSession: number[]; onAdd: (raiderId: number, itemLevel: number) => Promise<unknown> }) {
  const [roster, setRoster] = useState<RosterRaider[]>([]);
  const [raiderId, setRaiderId] = useState<string | null>(null);
  const [ilvl, setIlvl] = useState<number | string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.admin.raiders().then(setRoster).catch(() => {});
  }, [inSession.length]);

  const available = roster.filter((r) => !inSession.includes(r.id));
  const submit = async () => {
    if (!raiderId) return;
    setBusy(true);
    try {
      await onAdd(Number(raiderId), Number(ilvl) || 0);
      setRaiderId(null);
      setIlvl('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group gap="xs" mt="sm" align="flex-end" wrap="nowrap">
      <Select
        size="xs"
        style={{ flex: 1 }}
        label={
          <>
            Add raider{' '}
            <Anchor component={Link} to="/admin" size="xs">
              (manage roster)
            </Anchor>
          </>
        }
        placeholder={available.length ? 'Pick from the roster' : 'Everyone on the roster is already here'}
        data={available.map((r) => ({ value: String(r.id), label: r.username }))}
        value={raiderId}
        onChange={setRaiderId}
        searchable
        nothingFoundMessage="No such raider. Add them on the Admin page."
      />
      <NumberInput size="xs" w={90} label="ilvl" value={ilvl} min={0} allowDecimal={false} onChange={setIlvl} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      <Button size="xs" onClick={submit} loading={busy} disabled={!raiderId}>
        Add
      </Button>
    </Group>
  );
}

export function AdminSessionPage() {
  const { ok } = useRequireAdmin();
  const sessionId = Number(useParams().sessionId);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [rolls, setRolls] = useState<Record<number, RollEntry[]>>({});
  const [preview, setPreview] = useState<PlanPreviewView | null>(null);
  const { state: live, connected, send } = useSessionSocket(sessionId, null, true);

  // Loot, roster and roll history only change with a revision bump: fetched once per revision.
  const loadCore = useCallback(async () => {
    const [d, r] = await Promise.all([api.admin.session(sessionId), api.admin.rolls(sessionId).catch(() => null)]);
    setDetail(d);
    if (r) setRolls(r);
    return d.revision ?? null;
  }, [sessionId]);
  const refetchCore = useRevisionedFetch(loadCore, live?.revision, ok);

  // The pre-pick preview follows plansRevision (which also moves with revision). Leading debounce
  // so the first paint isn't delayed; trailing so a burst of raider clicks costs one refetch.
  const loadPlans = useCallback(async () => {
    const p = await api.admin.plans(sessionId);
    setPreview(p);
    return p.plansRevision;
  }, [sessionId]);
  const [plansRev] = useDebouncedValue(live?.plansRevision, 1000, { leading: true });
  const refetchPlans = useRevisionedFetch(loadPlans, plansRev, ok);
  const plans = preview?.items ?? {};
  const picks = preview?.summary ?? null;

  // The loot story is derived, not fetched: detail + roll history already carry everything.
  const summary = useMemo<SummaryItem[]>(() => (detail ? summarize(detail, rolls) : []), [detail, rolls]);

  if (!ok || !detail) return null;

  const pendingCount = detail.bosses.flatMap((b) => b.items).filter((i) => i.resolved_at == null).length;

  const run = (p: Promise<unknown>) =>
    p
      .then(() => {
        // Every admin action bumps the live revision, which drives the refetch; only refetch
        // explicitly when the socket is down and can't deliver that bump.
        if (!connected) {
          refetchCore(true);
          refetchPlans(true);
        }
      })
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));

  const phase = live?.phase ?? 'open';
  const rolling = phase === 'item' || phase === 'results';
  const paused = !!live?.paused;
  const editable = phase === 'open' || phase === 'ready';

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="xs" c="dimmed">
            {detail.season.name} ·{' '}
            <Anchor component={Link} to={`/s/${sessionId}`} size="xs">
              raider view
            </Anchor>
          </Text>
          <Title order={3}>{detail.session.name}</Title>
        </div>
        <Badge variant="light" color={connected ? 'green' : 'red'} size="sm">
          {connected ? 'live' : 'offline'}
        </Badge>
      </Group>

      <SectionCard
        title="Controls"
        collapsible
        right={
          paused ? (
            <Badge size="xs" variant="filled" color="yellow">
              paused
            </Badge>
          ) : (
            <StatusBadge status={detail.session.status} size="xs" />
          )
        }
      >
        <Group>
          {phase === 'open' && (
            <>
              <Button onClick={() => send({ type: 'stage' })} disabled={detail.raiders.length === 0 || pendingCount === 0}>
                Stage rolling (ready check)
              </Button>
              <Button
                variant="light"
                color="grape"
                disabled={pendingCount === 0}
                onClick={() => {
                  const withPicks = picks?.raiders.length ?? 0;
                  if (
                    confirm(
                      `Resolve all ${pendingCount} unrolled item${pendingCount === 1 ? '' : 's'} right now from pre-picks? No countdowns.\n\n` +
                        `${withPicks} of ${detail.raiders.length} raiders have pre-picks; ${live?.lockedIn.length ?? 0} say they're happy with them${live?.shuffle ? '. Priority order: Dibs/Need items first, least-contested first, random ties.' : '. List order.'}`,
                    )
                  )
                    send({ type: 'runBatch' });
                }}
              >
                Run instant batch
              </Button>
              <Button variant="default" onClick={() => confirm('Close this session? Raiders can no longer join.') && send({ type: 'close' })}>
                Close session
              </Button>
            </>
          )}
          {phase === 'closed' && (
            <Button variant="default" onClick={() => send({ type: 'reopen' })}>
              Reopen session
            </Button>
          )}
          {phase === 'ready' && (
            <Button onClick={() => send({ type: 'start' })}>
              Start now ({live?.readyRaiderIds.length ?? 0}/{detail.raiders.length} ready)
            </Button>
          )}
          {rolling && (
            <Text size="sm" c="dimmed">
              Pause / Skip / Auto-continue are in the live card above.
            </Text>
          )}
          {(rolling || phase === 'ready') && (
            <Button
              variant="subtle"
              color="red"
              onClick={() => confirm('Reset live state? Already-resolved items keep their winners.') && send({ type: 'reset' })}
            >
              Reset
            </Button>
          )}
        </Group>
        {(phase === 'ready' || phase === 'open') && (
          <Stack gap={6} mt="sm">
            <Checkbox
              size="xs"
              label="Auto-continue (untick to stop after every item until you press Start next item)"
              checked={live?.autoContinue ?? false}
              onChange={(e) => send({ type: 'setAutoContinue', value: e.currentTarget.checked })}
            />
            <Checkbox
              size="xs"
              label="Smart item order (Dibs/Need items first, least-contested first, random ties; untick for list order)"
              checked={live?.shuffle ?? true}
              onChange={(e) => send({ type: 'setShuffle', value: e.currentTarget.checked })}
            />
            {phase === 'open' && picks && pendingCount > 0 && (
              <Text size="xs" c="dimmed">
                <Text span c={live && live.lockedIn.length === detail.raiders.length && detail.raiders.length > 0 ? 'green.4' : undefined} fw={600}>
                  {live?.lockedIn.length ?? 0} of {detail.raiders.length} happy with their picks.
                </Text>{' '}
                Pre-picks: {picks.raiders.length} of {detail.raiders.length} raiders have set some
                {picks.raiders.length > 0 &&
                  ` (${picks.raiders
                    .map((p) => `${detail.raiders.find((r) => r.id === p.raiderId)?.username ?? '?'} ${p.picks}/${picks.unresolvedItems}`)
                    .join(', ')})`}
                .
              </Text>
            )}
          </Stack>
        )}
        {phase !== 'closed' && live && (
          <Group mt="sm" gap="md" align="flex-end">
            <NumberInput
              size="xs"
              w={140}
              label="Roll countdown (s)"
              min={1}
              max={600}
              allowDecimal={false}
              value={live.itemSeconds}
              onChange={(v) => typeof v === 'number' && v >= 1 && send({ type: 'setTimers', itemSeconds: v })}
            />
            <NumberInput
              size="xs"
              w={140}
              label="Results display (s)"
              min={1}
              max={600}
              allowDecimal={false}
              value={live.resultSeconds}
              onChange={(v) => typeof v === 'number' && v >= 1 && send({ type: 'setTimers', resultSeconds: v })}
            />
            <Text size="xs" c="dimmed">
              Applies to the next countdown.
            </Text>
          </Group>
        )}
        {phase === 'open' && (
          <Text size="xs" c="dimmed" mt="xs">
            {pendingCount} item{pendingCount === 1 ? '' : 's'} waiting to be rolled.
          </Text>
        )}
      </SectionCard>

      {summary.length > 0 && <SessionSummary items={summary} raidId={detail.season.raid_id} />}

      <BatchResults bosses={detail.bosses} raiders={detail.raiders} raidId={detail.season.raid_id} admin />

      {(phase === 'open' || phase === 'ready') && (
        <PrePickPreview bosses={detail.bosses} raiders={detail.raiders} plans={plans} lockedIn={live?.lockedIn ?? []} raidId={detail.season.raid_id} />
      )}


      {live && (
        <RollPanel
          live={live}
          bosses={detail.bosses}
          raiders={detail.raiders}
          raidId={detail.season.raid_id}
          me={null}
          onChoose={() => {}}
          onReady={() => {}}
          adminControls={{
            onPause: () => send({ type: 'pause' }),
            onResume: () => send({ type: 'resume' }),
            onSkip: () => send({ type: 'next' }),
            onSetAutoContinue: (value) => send({ type: 'setAutoContinue', value }),
          }}
        />
      )}

      <SectionCard title="Loot" collapsible defaultOpen right={<Text size="xs" c="dimmed">{pendingCount} unrolled</Text>}>
        <ItemList
          bosses={detail.bosses}
          raiders={detail.raiders}
          live={live}
          raidId={detail.season.raid_id}
          showTiers
          rolls={rolls}
          onAward={(itemId, raiderId, tier, force) =>
            run(
              api.admin.award(sessionId, itemId, raiderId, tier, force).then((r) => {
                if (tier && r.tier !== tier) notifications.show({ color: 'yellow', message: `Counted as ${TIER_LABEL[r.tier ?? 'greed']} - they had already won with Need/Dibs.` });
              }),
            )
          }
          onAddItem={editable ? (bossId, name, icon) => run(api.admin.addItem(sessionId, bossId, name, icon)) as Promise<void> : undefined}
          onDeleteItem={editable ? (id) => run(api.admin.deleteItem(sessionId, id)) : undefined}
          onDeleteBoss={editable ? (id) => confirm('Remove this boss and its items?') && run(api.admin.deleteBoss(sessionId, id)) : undefined}
        />
        {editable && (
          <>
            <Divider mt="xl" mb="sm" />
            <Title order={5} c="teal.2" mb="xs">
              Add boss
            </Title>
            <BossForm raidId={detail.season.raid_id} onSubmit={(name, icon, items) => run(api.admin.addBoss(sessionId, name, icon, items)) as Promise<void>} />
          </>
        )}
      </SectionCard>

      <SectionCard title="Raiders" collapsible defaultOpen right={<Text size="xs" c="dimmed">{detail.raiders.length} joined</Text>}>
        <RaiderTable
          raiders={detail.raiders}
          bosses={detail.bosses}
          raidId={detail.season.raid_id}
          editable={phase !== 'closed'}
          readyIds={phase === 'ready' ? live?.readyRaiderIds : undefined}
          lockedIn={phase === 'open' ? live?.lockedIn : undefined}
          onUpdate={(id, patch) => run(api.admin.updateRaider(sessionId, id, patch))}
          onRemove={(id) => confirm('Remove this raider from the session?') && run(api.admin.removeRaider(sessionId, id))}
        />
        {phase !== 'closed' && (
          <AddRaiderRow inSession={detail.raiders.map((r) => r.id)} onAdd={(rid, ilvl) => run(api.admin.addRaider(sessionId, rid, ilvl))} />
        )}
      </SectionCard>
    </Stack>
  );
}
