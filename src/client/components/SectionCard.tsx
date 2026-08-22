import { Avatar, Card, Divider, Group, Text, Title } from '@mantine/core';
import { ReactNode } from 'react';

/** Card with a teal-tinted header strip and a left accent bar. All page cards use this. */
export function SectionCard({
  title,
  right,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padding="md">
      <Card.Section
        withBorder
        inheritPadding
        py="xs"
        style={{
          background: 'linear-gradient(90deg, rgba(18,184,134,0.16), rgba(18,184,134,0.04) 60%, transparent)',
          borderLeft: '3px solid var(--mantine-color-teal-5)',
        }}
      >
        <Group justify="space-between">
          <Title order={5} c="teal.2">
            {title}
          </Title>
          {right}
        </Group>
      </Card.Section>
      <Card.Section inheritPadding pt="md" pb="md">
        {children}
      </Card.Section>
    </Card>
  );
}

/** Sub-header inside a card (e.g. a boss name above its items). */
export function SubHeader({ children, right, icon }: { children: ReactNode; right?: ReactNode; icon?: string | null }) {
  return (
    <Divider
      my="xs"
      labelPosition="left"
      label={
        <Group gap="xs">
          {icon && <Avatar src={icon} size="md" radius="sm" style={{ boxShadow: '0 0 0 2px var(--mantine-color-teal-7)' }} />}
          <Text size="xs" fw={700} tt="uppercase" c="teal.3" style={{ letterSpacing: '0.06em' }}>
            {children}
          </Text>
          {right}
        </Group>
      }
    />
  );
}

/** Centered card for single-purpose screens (password, name picker, admin login). */
export function GateCard({ title, tagline, children }: { title: string; tagline?: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 380, margin: '6vh auto 0' }}>
      <Text ta="center" fw={800} fz={34} className="brand" lh={1.1}>
        Blind Loot
      </Text>
      {tagline && (
        <Text ta="center" size="sm" c="dimmed" mb="md">
          {tagline}
        </Text>
      )}
      <SectionCard title={title}>{children}</SectionCard>
    </div>
  );
}
