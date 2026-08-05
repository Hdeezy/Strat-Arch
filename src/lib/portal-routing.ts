/**
 * WHERE DOES THIS PERSON BELONG?
 *
 * Roles live in three unrelated places — profiles.role, an advocates row, and
 * a merchant_staff row — and one human can legitimately hold more than one
 * (an outreach lead who also runs the console). So "which portal" is a
 * resolution, not a lookup, and it needs an order.
 *
 * Order is by authority, not by frequency: an operator who is also an
 * advocate lands on the console, because that is the surface where mistakes
 * are expensive and they should see the state of the money first.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type Portal = 'operator' | 'advocate' | 'vendor' | 'none'

export interface PortalAccess {
  portal: Portal
  href: string
  /** Every portal this person can reach, so the UI can offer a switch. */
  available: { portal: Exclude<Portal, 'none'>; href: string; label: string }[]
  displayName: string | null
}

const HREF: Record<Exclude<Portal, 'none'>, string> = {
  operator: '/admin',
  advocate: '/advocate',
  vendor: '/merchant',
}

const LABEL: Record<Exclude<Portal, 'none'>, string> = {
  operator: 'Operator console',
  advocate: 'Outreach',
  vendor: 'Vendor till',
}

export async function resolvePortalAccess(userId: string): Promise<PortalAccess> {
  const admin = createAdminClient()

  // One round trip each, in parallel — this runs on every visit to the front
  // door and is not worth a view.
  const [profileRes, advocateRes, staffRes] = await Promise.all([
    admin.from('profiles').select('role, full_name').eq('user_id', userId).maybeSingle(),
    admin.from('advocates').select('id').eq('user_id', userId).eq('is_active', true).maybeSingle(),
    admin.from('merchant_staff').select('id').eq('user_id', userId).eq('is_active', true).maybeSingle(),
  ])

  const profile = profileRes.data as { role?: string; full_name?: string | null } | null
  const isOperator = !!profile && ['charity_admin', 'super_admin'].includes(profile.role ?? '')
  const isAdvocate = !!advocateRes.data
  const isVendor = !!staffRes.data

  const available: PortalAccess['available'] = []
  if (isOperator) available.push({ portal: 'operator', href: HREF.operator, label: LABEL.operator })
  if (isAdvocate) available.push({ portal: 'advocate', href: HREF.advocate, label: LABEL.advocate })
  if (isVendor) available.push({ portal: 'vendor', href: HREF.vendor, label: LABEL.vendor })

  const first = available[0]
  const portal: Portal = first?.portal ?? 'none'

  return {
    portal,
    href: first ? first.href : '/',
    available,
    displayName: profile?.full_name ?? null,
  }
}
