// Database enums
export type CardState = 'unloaded' | 'active' | 'exhausted' | 'invalidated' | 'expired'
export type CardCategory = 'food' | 'transit' | 'clothing' | 'hygiene' | 'shelter' | 'multi'
export type CardEventType =
  | 'created'
  | 'loaded'
  | 'issued'
  | 'redemption_attempted'
  | 'redemption_succeeded'
  | 'redemption_failed'
  | 'invalidated'
  | 'expired'
export type ActorType = 'system' | 'donor' | 'advocate' | 'merchant' | 'admin'
export type RedemptionStatus = 'pending' | 'succeeded' | 'failed' | 'refunded'
export type UserRole = 'donor' | 'advocate' | 'merchant_staff' | 'charity_admin' | 'super_admin'

// Database row types
export interface City {
  id: string
  name: string
  province: string
  country: string
  created_at: string
}

export interface Charity {
  id: string
  city_id: string
  name: string
  cra_registration: string | null
  contact_email: string
  stripe_connect_account_id: string | null
  bank_designated_account_ref: string | null
  is_active: boolean
  created_at: string
}

export interface Merchant {
  id: string
  city_id: string
  charity_id: string
  name: string
  address: string
  lat: number | null
  lng: number | null
  category: CardCategory
  stripe_connect_account_id: string | null
  payout_schedule_days: number
  is_active: boolean
  trust_score: number
  created_at: string
}

export interface Card {
  id: string
  city_id: string
  charity_id: string
  card_code: string
  state: CardState
  balance_cents: number
  allowed_categories: CardCategory[]
  daily_cap_cents: number
  spent_today_cents: number
  last_spent_reset_at: string
  signed_payload: string | null
  created_at: string
}

export interface Donation {
  id: string
  card_id: string
  donor_user_id: string | null
  donor_email: string | null
  amount_cents: number
  stripe_payment_intent_id: string
  stripe_receipt_url: string | null
  donor_note: string | null
  receipt_requested: boolean
  receipt_issued_at: string | null
  created_at: string
}

export interface CardEvent {
  id: string
  card_id: string
  event_type: CardEventType
  actor_type: ActorType
  actor_ref: string
  metadata: Record<string, unknown>
  occurred_at: string
}

export interface Redemption {
  id: string
  card_id: string
  merchant_id: string
  amount_cents: number
  status: RedemptionStatus
  failure_reason: string | null
  idempotency_key: string
  nonce: string
  occurred_at: string
}

export interface Advocate {
  id: string
  charity_id: string
  user_id: string
  full_name: string
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface Profile {
  user_id: string
  role: UserRole
  full_name: string | null
  phone: string | null
  created_at: string
}

export interface MerchantStaff {
  id: string
  merchant_id: string
  user_id: string
  is_active: boolean
  created_at: string
}

export interface UsedNonce {
  nonce: string
  card_id: string
  used_at: string
  expires_at: string
}

// Database type map for Supabase generics
export interface Database {
  public: {
    Tables: {
      cities: { Row: City; Insert: Omit<City, 'id' | 'created_at'> & Partial<Pick<City, 'id' | 'created_at'>>; Update: Partial<City> }
      charities: { Row: Charity; Insert: Omit<Charity, 'id' | 'created_at'> & Partial<Pick<Charity, 'id' | 'created_at'>>; Update: Partial<Charity> }
      merchants: { Row: Merchant; Insert: Omit<Merchant, 'id' | 'created_at'> & Partial<Pick<Merchant, 'id' | 'created_at'>>; Update: Partial<Merchant> }
      cards: { Row: Card; Insert: Omit<Card, 'id' | 'created_at'> & Partial<Pick<Card, 'id' | 'created_at'>>; Update: Partial<Card> }
      donations: { Row: Donation; Insert: Omit<Donation, 'id' | 'created_at'> & Partial<Pick<Donation, 'id' | 'created_at'>>; Update: Partial<Donation> }
      card_events: { Row: CardEvent; Insert: Omit<CardEvent, 'id' | 'occurred_at'> & Partial<Pick<CardEvent, 'id' | 'occurred_at'>>; Update: never }
      redemptions: { Row: Redemption; Insert: Omit<Redemption, 'id' | 'occurred_at'> & Partial<Pick<Redemption, 'id' | 'occurred_at'>>; Update: Partial<Redemption> }
      advocates: { Row: Advocate; Insert: Omit<Advocate, 'id' | 'created_at'> & Partial<Pick<Advocate, 'id' | 'created_at'>>; Update: Partial<Advocate> }
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at'> & Partial<Pick<Profile, 'created_at'>>; Update: Partial<Profile> }
      merchant_staff: { Row: MerchantStaff; Insert: Omit<MerchantStaff, 'id' | 'created_at'> & Partial<Pick<MerchantStaff, 'id' | 'created_at'>>; Update: Partial<MerchantStaff> }
      used_nonces: { Row: UsedNonce; Insert: UsedNonce; Update: never }
    }
    Enums: {
      card_state: CardState
      card_category: CardCategory
      card_event_type: CardEventType
      actor_type: ActorType
      redemption_status: RedemptionStatus
      user_role: UserRole
    }
  }
}

// Application-level types
export interface QRPayload {
  card_id: string
  card_code: string
  city_id: string
  charity_id: string
  nonce: string
  iat: number
  exp: number
}

export interface CardWithChainOfCustody extends Card {
  events: CardEvent[]
  donations: Donation[]
  redemptions: (Redemption & { merchant: Pick<Merchant, 'id' | 'name' | 'address' | 'category'> })[]
}

export interface RedemptionCheckResult {
  valid: boolean
  card?: Card
  failure_reason?: string
}

export type AmountPreset = 500 | 1000 | 1500 | 2000 | 2500
export const AMOUNT_PRESETS: AmountPreset[] = [500, 1000, 1500, 2000, 2500]

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  food: 'Food & Meals',
  transit: 'Transit',
  clothing: 'Clothing',
  hygiene: 'Hygiene',
  shelter: 'Shelter',
  multi: 'All Categories',
}

export const CATEGORY_ICONS: Record<CardCategory, string> = {
  food: '🍽️',
  transit: '🚌',
  clothing: '👕',
  hygiene: '🧼',
  shelter: '🏠',
  multi: '✨',
}
