import { getDailyCapRemaining, isNewDay } from '@/lib/utils'
import { formatInTimeZone } from 'date-fns-tz'

const HAMILTON_TZ = 'America/Toronto'

describe('Daily cap enforcement', () => {
  describe('isNewDay', () => {
    it('returns false if last reset was today', () => {
      const todayStr = formatInTimeZone(new Date(), HAMILTON_TZ, "yyyy-MM-dd'T'HH:mm:ssxxx")
      expect(isNewDay(todayStr)).toBe(false)
    })

    it('returns true if last reset was yesterday', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString()
      expect(isNewDay(yesterdayStr)).toBe(true)
    })

    it('returns true if last reset was 2 days ago', () => {
      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
      expect(isNewDay(twoDaysAgo.toISOString())).toBe(true)
    })
  })

  describe('getDailyCapRemaining', () => {
    it('returns full cap if nothing has been spent today', () => {
      const card = {
        daily_cap_cents: 2000,
        spent_today_cents: 0,
        last_spent_reset_at: new Date().toISOString(),
      }
      expect(getDailyCapRemaining(card)).toBe(2000)
    })

    it('returns remaining cap after partial spend', () => {
      const card = {
        daily_cap_cents: 2000,
        spent_today_cents: 800,
        last_spent_reset_at: new Date().toISOString(),
      }
      expect(getDailyCapRemaining(card)).toBe(1200)
    })

    it('returns 0 if daily cap is fully used', () => {
      const card = {
        daily_cap_cents: 2000,
        spent_today_cents: 2000,
        last_spent_reset_at: new Date().toISOString(),
      }
      expect(getDailyCapRemaining(card)).toBe(0)
    })

    it('returns full cap if last reset was yesterday (lazy reset)', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const card = {
        daily_cap_cents: 2000,
        spent_today_cents: 1500, // Spent yesterday, but should reset
        last_spent_reset_at: yesterday.toISOString(),
      }
      // isNewDay = true, so return full cap
      expect(getDailyCapRemaining(card)).toBe(2000)
    })

    it('never returns a negative value', () => {
      const card = {
        daily_cap_cents: 2000,
        spent_today_cents: 2500, // Over-spent (shouldn't happen but defensive)
        last_spent_reset_at: new Date().toISOString(),
      }
      expect(getDailyCapRemaining(card)).toBe(0)
    })
  })
})
