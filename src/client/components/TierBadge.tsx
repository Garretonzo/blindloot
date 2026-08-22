import { Badge, MantineSize } from '@mantine/core';
import { Tier, TIER_COLOR, TIER_LABEL } from '../../shared/types';

export function TierBadge({ tier, size = 'xs' }: { tier: Tier; size?: MantineSize }) {
  return (
    <Badge size={size} variant="light" color={TIER_COLOR[tier]}>
      {TIER_LABEL[tier]}
    </Badge>
  );
}
