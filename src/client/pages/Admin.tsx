import { Anchor, Badge, Button, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { RAIDS, raidById, raidLabel } from '../../shared/raids';
import { SectionCard, SubHeader } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { notifications } from '@mantine/notifications';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, BackupMeta, RosterRaider } from '../api';
import { useIdentity } from '../identity';
import { Season, Session } from '../../shared/types';

export function useRequireAdmin() {
  const nav = useNavigate();
  const [ok, setOk] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => {
    api.admin.me().then((r) => {
      if (!r.admin) return nav('/admin/login', { replace: true });
      setOk(true);
      setIsSuper(r.super);
    });
  }, [nav]);
  return { ok, isSuper };
}

/** Site-wide raider roster: add, rename, (super) delete. */
function RosterCard({ isSuper }: { isSuper: boolean }) {
  const { online } = useIdentity();
  const [roster, setRoster] = useState<RosterRaider[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.admin.raiders().then(setRoster).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const fail = (e: Error) => notifications.show({ color: 'red', message: e.message });
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.admin.createRaider(name.trim());
      if (!r.created) notifications.show({ color: 'yellow', message: `${r.username} is already on the roster` });
      setName('');
      load();
    } catch (e) {
      fail(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const rename = (id: number, username: string) => api.admin.renameRaider(id, username).then(load).catch(fail);
  const remove = (r: RosterRaider) =>
    confirm(`Delete ${r.username} from the roster?`) && api.admin.deleteRaider(r.id).then(load).catch(fail);
  const endLogin = (r: RosterRaider) => api.admin.endLogin(r.id).catch(fail);
  const resetPassword = (r: RosterRaider) =>
    confirm(`Reset ${r.username}'s password? They'll choose a new one on their next login.`) &&
    api.admin.resetPassword(r.id).then(load).catch(fail);

  return (
    <SectionCard
      title="Raiders"
      right={
        <Text size="xs" c="dimmed">
          {roster.length} on roster · {online.size} logged in
        </Text>
      }
    >
      <Group align="flex-end" mb="sm">
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          placeholder="New raider name"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button size="xs" onClick={add} loading={busy} disabled={!name.trim()}>
          Add raider
        </Button>
      </Group>
      {roster.length === 0 ? (
        <Text size="sm" c="dimmed">
          No raiders yet.
        </Text>
      ) : (
        <Table verticalSpacing={4} withRowBorders={false}>
          <Table.Tbody>
            {roster.map((r) => (
              <RosterRow
                key={r.id}
                r={r}
                isSuper={isSuper}
                online={online.has(r.id)}
                onRename={rename}
                onRemove={remove}
                onEndLogin={endLogin}
                onResetPassword={resetPassword}
              />
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Raiders are site-wide. Dibs is tracked per season and item level per session.
      </Text>
    </SectionCard>
  );
}

function RosterRow({
  r,
  isSuper,
  online,
  onRename,
  onRemove,
  onEndLogin,
  onResetPassword,
}: {
  r: RosterRaider;
  isSuper: boolean;
  online: boolean;
  onRename: (id: number, username: string) => void;
  onRemove: (r: RosterRaider) => void;
  onEndLogin: (r: RosterRaider) => void;
  onResetPassword: (r: RosterRaider) => void;
}) {
  const [name, setName] = useState(r.username);
  useEffect(() => setName(r.username), [r.username]);
  return (
    <Table.Tr>
      <Table.Td>
        <TextInput
          size="xs"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={() => name.trim() && name.trim() !== r.username && onRename(r.id, name.trim())}
        />
      </Table.Td>
      <Table.Td w={200}>
        <Group gap={6} wrap="nowrap">
          {online ? (
            <Badge size="xs" variant="dot" color="green">
              logged in
            </Badge>
          ) : (
            <Text size="xs" c="dimmed">
              offline
            </Text>
          )}
          {!r.has_password && (
            <Badge size="xs" variant="light" color="yellow" title="They'll choose a password on their next login.">
              no password
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td w={230} ta="right">
        <Group gap="sm" justify="flex-end">
          {online && (
            <Anchor component="button" size="xs" onClick={() => onEndLogin(r)}>
              End login
            </Anchor>
          )}
          {!!r.has_password && isSuper && (
            <Anchor component="button" size="xs" onClick={() => onResetPassword(r)} title="Back to passwordless; they set a new one on next login.">
              Reset password
            </Anchor>
          )}
          {isSuper && (
            <Anchor component="button" size="xs" c="red" onClick={() => onRemove(r)}>
              Delete
            </Anchor>
          )}
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Super-only: in-app restore points plus file export/import, so history survives both
 * fat-fingered deletes and anything happening to the hosted database.
 */
function BackupsCard() {
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(() => {
    api.admin.backups.list().then(setBackups).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const fail = (e: Error) => notifications.show({ color: 'red', message: e.message });
  const create = async () => {
    setBusy(true);
    try {
      await api.admin.backups.create(name.trim());
      setName('');
      load();
      notifications.show({ color: 'teal', message: 'Restore point created' });
    } catch (e) {
      fail(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (b: BackupMeta) => {
    if (!confirm(`Restore "${b.name}" (${fmtDate(b.created_at)})?\n\nALL current data will be replaced. A backup of the current state is saved first, so this can be undone.`)) return;
    setBusy(true);
    try {
      await api.admin.backups.restore(b.id);
      window.location.reload(); // everything changed; start fresh
    } catch (e) {
      fail(e as Error);
      setBusy(false);
    }
  };
  const remove = (b: BackupMeta) =>
    confirm(`Delete restore point "${b.name}"?`) && api.admin.backups.delete(b.id).then(load).catch(fail);
  const importFile = async (file: File) => {
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('That is not a backup file (invalid JSON)');
      }
      if (!confirm(`Import "${file.name}"?\n\nALL current data will be replaced by the file's contents. A backup of the current state is saved first, so this can be undone.`)) return;
      await api.admin.backups.import(parsed);
      window.location.reload();
    } catch (e) {
      fail(e as Error);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <SectionCard
      title="Backups"
      collapsible
      defaultOpen={false}
      right={
        <Group gap="sm">
          <Anchor href="/api/admin/export" size="sm" title="Download all current data as a file you can keep locally.">
            Export data
          </Anchor>
          <Anchor component="button" size="sm" onClick={() => fileRef.current?.click()} title="Replace all data with a previously exported file.">
            Import…
          </Anchor>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => e.currentTarget.files?.[0] && importFile(e.currentTarget.files[0])}
          />
        </Group>
      }
    >
      <Group align="flex-end" mb="sm">
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          placeholder="Restore point name (e.g. before season cleanup)"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <Button size="xs" onClick={create} loading={busy}>
          Create restore point
        </Button>
      </Group>
      {backups.length === 0 ? (
        <Text size="sm" c="dimmed">
          No restore points yet. Create one before risky changes — restoring replaces all data with the snapshot.
        </Text>
      ) : (
        <Table verticalSpacing={4} withRowBorders={false}>
          <Table.Tbody>
            {backups.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm">{b.name}</Text>
                    {b.kind !== 'manual' && (
                      <Badge size="xs" variant="light" color="gray" title="Created automatically before a restore/import; only the newest few are kept.">
                        auto
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td w={190}>
                  <Text size="xs" c="dimmed">
                    {fmtDate(b.created_at)}
                  </Text>
                </Table.Td>
                <Table.Td w={80}>
                  <Text size="xs" c="dimmed">
                    {fmtBytes(b.bytes)}
                  </Text>
                </Table.Td>
                <Table.Td w={210} ta="right">
                  <Group gap="sm" justify="flex-end">
                    <Anchor component="button" size="xs" onClick={() => restore(b)} disabled={busy}>
                      Restore
                    </Anchor>
                    <Anchor href={`/api/admin/backups/${b.id}/export`} size="xs">
                      Download
                    </Anchor>
                    <Anchor component="button" size="xs" c="red" onClick={() => remove(b)}>
                      Delete
                    </Anchor>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Restore points live in the site's database. Use Export now and then to keep a copy on your own disk.
      </Text>
    </SectionCard>
  );
}

/** Text that turns into an input on "rename"; Enter or blur saves, Escape cancels. */
function EditableName({ value, onSave, children }: { value: string; onSave: (name: string) => Promise<unknown>; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== value) await onSave(name);
    else setDraft(value);
  };
  if (!editing) {
    return (
      <Group gap={6} wrap="nowrap">
        {children}
        <Anchor
          component="button"
          size="xs"
          c="dimmed"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          rename
        </Anchor>
      </Group>
    );
  }
  return (
    <TextInput
      size="xs"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** Per-season charge limits. Saving applies retroactively: remaining = new limit − wins already recorded. */
function SeasonLimits({ season, onSaved }: { season: Season; onSaved: () => void }) {
  const [dibs, setDibs] = useState<number | string>(season.dibs_per_season);
  const [need, setNeed] = useState<number | string>(season.need_per_session);
  useEffect(() => setDibs(season.dibs_per_season), [season.dibs_per_season]);
  useEffect(() => setNeed(season.need_per_session), [season.need_per_session]);

  const save = async (limits: { dibsPerSeason?: number; needPerSession?: number }) => {
    try {
      await api.admin.updateSeasonLimits(season.id, limits);
      onSaved();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  };

  return (
    <Group gap="md" mb="sm" align="flex-end">
      <NumberInput
        label="Dibs / season"
        size="xs"
        w={110}
        min={0}
        max={99}
        allowDecimal={false}
        value={dibs}
        onChange={setDibs}
        onBlur={() => typeof dibs === 'number' && dibs !== season.dibs_per_season && save({ dibsPerSeason: dibs })}
      />
      <NumberInput
        label="Need wins / session"
        size="xs"
        w={140}
        min={0}
        max={99}
        allowDecimal={false}
        value={need}
        onChange={setNeed}
        onBlur={() => typeof need === 'number' && need !== season.need_per_session && save({ needPerSession: need })}
      />
      <Text size="xs" c="dimmed" pb={6}>
        Changes apply to everyone immediately (remaining = limit − wins).
      </Text>
    </Group>
  );
}

export function AdminHome() {
  const { ok, isSuper } = useRequireAdmin();
  const nav = useNavigate();
  const [data, setData] = useState<{ seasons: Season[]; sessions: Session[] } | null>(null);
  const [seasonName, setSeasonName] = useState('');
  const [raidId, setRaidId] = useState<string | null>(RAIDS.length === 1 ? RAIDS[0].id : null);
  const [newDibs, setNewDibs] = useState<number | string>(1);
  const [newNeed, setNewNeed] = useState<number | string>(1);
  const [sessionNames, setSessionNames] = useState<Record<number, string>>({});

  const refresh = useCallback(() => {
    api.seasons().then(setData);
  }, []);
  useEffect(() => {
    if (ok) refresh();
  }, [ok, refresh]);

  if (!ok || !data) return null;

  const createSeason = async () => {
    if (!seasonName.trim() || !raidId) return;
    await api.admin
      .createSeason(seasonName, raidId, typeof newDibs === 'number' ? newDibs : 1, typeof newNeed === 'number' ? newNeed : 1)
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    setSeasonName('');
    refresh();
  };

  const createSession = async (seasonId: number) => {
    const name = sessionNames[seasonId]?.trim();
    if (!name) return;
    const s = await api.admin.createSession(seasonId, name);
    nav(`/admin/s/${s.id}`);
  };

  const fail = (e: Error) => notifications.show({ color: 'red', message: e.message });
  const renameSeason = (id: number, name: string) => api.admin.renameSeason(id, name).then(refresh).catch(fail);
  const renameSession = (id: number, name: string) => api.admin.renameSession(id, name).then(refresh).catch(fail);

  const deleteSeason = async (season: Season) => {
    if (!confirm(`Delete season "${season.name}" and ALL its sessions and history? This cannot be undone.`)) return;
    await api.admin.deleteSeason(season.id).catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    refresh();
  };

  const deleteSession = async (s: Session) => {
    if (!confirm(`Delete session "${s.name}" and its loot history?`)) return;
    await api.admin.deleteSession(s.id).catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    refresh();
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={3}>Admin</Title>
          {isSuper && (
            <Badge size="xs" variant="light" color="orange">
              super
            </Badge>
          )}
        </Group>
        <Button
          variant="subtle"
          size="xs"
          color="gray"
          onClick={async () => {
            await api.admin.logout();
            nav('/');
          }}
        >
          Log out
        </Button>
      </Group>

      <SectionCard title="New season">
        <Group align="flex-end">
          <TextInput
            style={{ flex: 1 }}
            label="Name"
            placeholder="e.g. Season 3"
            value={seasonName}
            onChange={(e) => setSeasonName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSeason()}
          />
          <Select
            style={{ flex: 1 }}
            label="Boss / loot pool"
            placeholder="Pick a pool"
            data={RAIDS.map((r) => ({ value: r.id, label: raidLabel(r) }))}
            value={raidId}
            onChange={setRaidId}
            allowDeselect={false}
          />
          <NumberInput label="Dibs / season" w={110} min={0} max={99} allowDecimal={false} value={newDibs} onChange={setNewDibs} />
          <NumberInput label="Need wins / session" w={140} min={0} max={99} allowDecimal={false} value={newNeed} onChange={setNewNeed} />
          <Button onClick={createSeason} disabled={!seasonName.trim() || !raidId}>
            Create
          </Button>
        </Group>
      </SectionCard>

      <RosterCard isSuper={isSuper} />

      {isSuper && <BackupsCard />}

      {data.seasons.map((season) => (
        <SectionCard
          key={season.id}
          title={
            <Group gap="xs">
              <EditableName value={season.name} onSave={(n) => renameSeason(season.id, n)}>
                {season.name}
              </EditableName>
              <Text size="xs" c="dimmed" fw={400}>
                {raidById(season.raid_id) ? raidLabel(raidById(season.raid_id)!) : season.raid_id}
              </Text>
            </Group>
          }
          right={
            <Group gap="sm">
              <Anchor component={Link} to={`/admin/seasons/${season.id}/history`} size="sm">
                History
              </Anchor>
              {isSuper && (
                <Anchor component="button" size="sm" c="red" onClick={() => deleteSeason(season)}>
                  Delete
                </Anchor>
              )}
            </Group>
          }
        >
          <SeasonLimits season={season} onSaved={refresh} />
          <SubHeader>Sessions</SubHeader>
          <Stack gap={4} mb="sm" pl="sm">
            {data.sessions
              .filter((s) => s.season_id === season.id)
              .map((s) => (
                <Group key={s.id} justify="space-between">
                  <EditableName value={s.name} onSave={(n) => renameSession(s.id, n)}>
                    <Anchor component={Link} to={`/admin/s/${s.id}`}>
                      {s.name}
                    </Anchor>
                  </EditableName>
                  <Group gap="sm">
                    <StatusBadge status={s.status} />
                    {isSuper && (
                      <Anchor component="button" size="xs" c="red" onClick={() => deleteSession(s)}>
                        Delete
                      </Anchor>
                    )}
                  </Group>
                </Group>
              ))}
            {data.sessions.every((s) => s.season_id !== season.id) && (
              <Text size="sm" c="dimmed">
                No sessions yet.
              </Text>
            )}
          </Stack>
          <SubHeader>New session</SubHeader>
          <Group align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              size="xs"
              placeholder="New session name"
              value={sessionNames[season.id] ?? ''}
              onChange={(e) => setSessionNames({ ...sessionNames, [season.id]: e.currentTarget.value })}
              onKeyDown={(e) => e.key === 'Enter' && createSession(season.id)}
            />
            <Button size="xs" variant="default" onClick={() => createSession(season.id)}>
              Create session
            </Button>
          </Group>
        </SectionCard>
      ))}
    </Stack>
  );
}
