import { Avatar, MantineSize } from '@mantine/core';

/** A raider's uploaded avatar, falling back to colored initials. Square, WoW-icon style. */
export function RaiderAvatar({
  avatar,
  username,
  size = 'md',
  ring,
}: {
  avatar?: string | null;
  username: string;
  size?: MantineSize | number;
  ring?: boolean;
}) {
  return (
    <Avatar
      src={avatar ?? undefined}
      name={username}
      color="initials"
      alt={username}
      size={size}
      radius="sm"
      style={ring ? { boxShadow: '0 0 0 2px var(--mantine-color-teal-7)' } : undefined}
    />
  );
}
