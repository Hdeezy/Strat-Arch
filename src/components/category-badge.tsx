import { Badge } from '@/components/ui/badge'
import { CATEGORY_LABELS, CATEGORY_ICONS, type CardCategory } from '@/lib/types'

export function CategoryBadge({ category }: { category: CardCategory }) {
  return (
    <Badge variant="outline" className="gap-1">
      <span>{CATEGORY_ICONS[category]}</span>
      <span>{CATEGORY_LABELS[category]}</span>
    </Badge>
  )
}
