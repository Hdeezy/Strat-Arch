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

/**
 * Card codes are PREFIX-SUFFIX.
 *
 * New cards carry 8 characters of Crockford base32 so the code is
 * non-enumerable — Scrappy Cut §3a control 1: "Sequential codes would turn
 * this page into a balance-scanning tool across the whole program."
 *
 * Legacy pilot cards (HMLT-0001) have 4 and still validate, which is why the
 * suffix length is a range rather than a fixed 8. Never generate a
 * sequential code; use generate_card_code() in the database.
 *
 * The prefix stays exactly 4 — it is a city code, not a variable field.
 */
export const CARD_CODE_PATTERN = /^[A-Z]{4}-[A-Z0-9]{4,10}$/

export function validateCardCode(code: string): boolean {
  return CARD_CODE_PATTERN.test(code)
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

// Extracts a HOPE Card code from a QR URL (e.g. /donate/HMLT-3F7K2QX9).
// Returns null when the raw string is not a card URL (e.g. it's already a JWT).
export function extractCardCodeFromQR(raw: string): string | null {
  const match = raw.match(/\/(?:donate|wallet)\/([A-Z]{4}-[A-Z0-9]{4,10})/i)
  return match ? match[1].toUpperCase() : null
}

/**
 * ROOM TODAY — the only spend figure the vendor UI is allowed to show.
 *
 * Scrappy Cut §4: "Vendor UI shows available room, never a decline for
 * insufficient funds."
 *
 * The difference is not cosmetic. "Insufficient funds" is a statement about
 * the person, delivered at a counter, in a queue. "Room today: $18" is a
 * statement about the card. Same number, and only one of them is something
 * you would want said about you out loud.
 *
 * Room is the lesser of what is on the card and what the daily cap still
 * allows, so a vendor is never invited to attempt an amount that will fail.
 */
export function roomToday(card: {
  balance_cents: number
  daily_cap_cents: number
  spent_today_cents: number
  last_spent_reset_at: string
}): number {
  return Math.min(card.balance_cents, getDailyCapRemaining(card))
}
