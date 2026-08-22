import { Badge, MantineSize } from '@mantine/core';
import { SessionStatus } from '../../shared/types';

const STATUS: Record<SessionStatus, { color: string; label: string; dot?: boolean }> = {
  open: { color: 'teal', label: 'open' },
  staging: { color: 'yellow', label: 'ready check' },
  rolling: { color: 'red', label: 'rolling', dot: true },
  closed: { color: 'gray', label: 'closed' },
};

export function StatusBadge({ status, size = 'sm' }: { status: SessionStatus; size?: MantineSize }) {
  const s = STATUS[status] ?? { color: 'gray', label: status };
  return (
    <Badge size={size} variant={s.dot ? 'dot' : 'light'} color={s.color} className={s.dot ? 'blink' : undefined}>
      {s.label}
    </Badge>
  );
}
