import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatInTimeZone } from 'date-fns-tz'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const HAMILTON_TZ = 'America/Toronto'

export function formatCAD(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100)
}

export function formatDateHamilton(date: string | Date): string {
  return formatInTimeZone(new Date(date), HAMILTON_TZ, 'MMM d, yyyy \'at\' h:mm a')
}

export function isNewDay(lastReset: string): boolean {
  const hamiltonNow = formatInTimeZone(new Date(), HAMILTON_TZ, 'yyyy-MM-dd')
  const resetDay = formatInTimeZone(new Date(lastReset), HAMILTON_TZ, 'yyyy-MM-dd')
  return hamiltonNow > resetDay
}

export function validateCardCode(code: string): boolean {
  return /^[A-Z]{4}-[A-Z0-9]{4}$/.test(code.toUpperCase())
}

export function normalizeCardCode(code: string): string {
  return code.toUpperCase().trim()
}

// Returns daily cap remaining in cents, resetting if needed
export function getDailyCapRemaining(card: {
  daily_cap_cents: number
  spent_today_cents: number
  last_spent_reset_at: string
}): number {
  if (isNewDay(card.last_spent_reset_at)) {
    return card.daily_cap_cents
  }
  return Math.max(0, card.daily_cap_cents - card.spent_today_cents)
}

export function isCategoryAllowed(
  merchantCategory: string,
  allowedCategories: string[]
): boolean {
  if (allowedCategories.includes('multi')) return true
  return allowedCategories.includes(merchantCategory)
}
