import { Avatar, Card, Divider, Group, Text, Title } from '@mantine/core';
import { ReactNode } from 'react';

/** Card with a clearly separated header strip. All page cards use this. */
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
    <Card withBorder padding="md">
      <Card.Section withBorder inheritPadding py="xs" bg="var(--mantine-color-default-hover)">
        <Group justify="space-between">
          <Title order={5}>{title}</Title>
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
          {icon && <Avatar src={icon} size="sm" radius="sm" />}
          <Text size="xs" fw={700} tt="uppercase" c="blue.4" style={{ letterSpacing: '0.06em' }}>
            {children}
          </Text>
          {right}
        </Group>
      }
    />
  );
}
