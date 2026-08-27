import { Anchor, Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRef, useState } from 'react';
import { api } from '../api';
import { fileToAvatar } from '../avatar';
import { AVATAR_UPDATED_EVENT, useIdentity, useMyAvatar } from '../identity';
import { RaiderAvatar } from './RaiderAvatar';
import { SectionCard } from './SectionCard';

/** The viewer's profile: their avatar (uploadable) and name. Shown at the top of the Home page. */
export function ProfileCard() {
  const { identity } = useIdentity();
  const avatar = useMyAvatar();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!identity) return null;

  const save = async (url: string | null) => {
    setBusy(true);
    try {
      await api.setAvatar(url);
      window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail: url }));
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File) => {
    try {
      await save(await fileToAvatar(file));
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <SectionCard title="Profile" collapsible>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap">
          <RaiderAvatar avatar={avatar} username={identity.username} size="lg" ring />
          <Text fw={600}>{identity.username}</Text>
        </Group>
        <Group gap="sm" wrap="nowrap">
          {avatar && (
            <Anchor component="button" size="xs" c="dimmed" onClick={() => save(null)}>
              remove
            </Anchor>
          )}
          <Button size="xs" variant="default" loading={busy} onClick={() => fileRef.current?.click()}>
            {avatar ? 'Change icon' : 'Upload icon'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => e.currentTarget.files?.[0] && pickFile(e.currentTarget.files[0])}
          />
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        Your icon shows up next to your name across the site. It gets shrunk to a small square automatically.
      </Text>
    </SectionCard>
  );
}
