import { Badge } from '@/components/ui/badge'
import type { CardState } from '@/lib/types'

const STATE_CONFIG: Record<CardState, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' | 'outline' }> = {
  unloaded: { label: 'Unloaded', variant: 'secondary' },
  active: { label: 'Active', variant: 'success' },
  exhausted: { label: 'Exhausted', variant: 'warning' },
  invalidated: { label: 'Invalidated', variant: 'destructive' },
  expired: { label: 'Expired', variant: 'outline' },
}

export function CardStateBadge({ state }: { state: CardState }) {
  const config = STATE_CONFIG[state]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
