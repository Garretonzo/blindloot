import { Avatar, MantineSize } from '@mantine/core';

/** Square WoW-style icon; renders nothing when there is no icon (custom entries). */
export function Icon({ src, size = 'sm', alt }: { src: string | null | undefined; size?: MantineSize | number; alt?: string }) {
  if (!src) return null;
  return <Avatar src={src} alt={alt ?? ''} size={size} radius="sm" />;
}
