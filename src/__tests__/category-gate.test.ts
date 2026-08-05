import { isCategoryAllowed } from '@/lib/utils'

describe('Category gate enforcement', () => {
  it('allows food merchant for card with food in allowed categories', () => {
    expect(isCategoryAllowed('food', ['food', 'transit', 'clothing'])).toBe(true)
  })

  it('rejects clothing merchant for food-only card', () => {
    expect(isCategoryAllowed('clothing', ['food'])).toBe(false)
  })

  it('rejects transit merchant for card with only food and hygiene', () => {
    expect(isCategoryAllowed('transit', ['food', 'hygiene'])).toBe(false)
  })

  it('allows any merchant category when card has multi in allowed categories', () => {
    expect(isCategoryAllowed('clothing', ['multi'])).toBe(true)
    expect(isCategoryAllowed('shelter', ['multi'])).toBe(true)
    expect(isCategoryAllowed('transit', ['multi'])).toBe(true)
    expect(isCategoryAllowed('hygiene', ['multi'])).toBe(true)
    expect(isCategoryAllowed('food', ['multi'])).toBe(true)
  })

  it('allows matching category in full default set', () => {
    const defaultCategories = ['food', 'transit', 'clothing', 'hygiene']
    expect(isCategoryAllowed('food', defaultCategories)).toBe(true)
    expect(isCategoryAllowed('transit', defaultCategories)).toBe(true)
    expect(isCategoryAllowed('clothing', defaultCategories)).toBe(true)
    expect(isCategoryAllowed('hygiene', defaultCategories)).toBe(true)
  })

  it('rejects shelter merchant against default categories (shelter not in default)', () => {
    const defaultCategories = ['food', 'transit', 'clothing', 'hygiene']
    expect(isCategoryAllowed('shelter', defaultCategories)).toBe(false)
  })

  it('rejects with empty allowed categories', () => {
    expect(isCategoryAllowed('food', [])).toBe(false)
  })

  it('is case-sensitive — exact match required', () => {
    // Category values in the DB are lowercase enums
    expect(isCategoryAllowed('food', ['food'])).toBe(true)
    expect(isCategoryAllowed('Food', ['food'])).toBe(false)
  })
})
