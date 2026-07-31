/**
 * Idempotency keys for the money path.
 *
 * Every ledger transaction carries one, and it is UNIQUE at the database
 * level. Replaying a request with the same key returns the original
 * transaction rather than posting a second one. That is what makes a retried
 * Stripe webhook, a double-tapped Charge button, and a late offline sync
 * safe by construction rather than by care.
 *
 * Keys are derived from the natural identity of the event, never from a
 * random value generated at call time — a random key would make every retry
 * a new transaction, which is precisely the failure this prevents.
 */

export const idem = {
  /** A Stripe payment intent can only ever produce one donation. */
  donationReceived: (paymentIntentId: string) => `donation:${paymentIntentId}`,

  /** A donation clears exactly once. */
  donationCleared: (donationId: string) => `clear:${donationId}`,

  /** A reversal is keyed to the Stripe dispute or refund, not the donation,
   *  because one donation can be partially refunded more than once. */
  donationReversed: (reversalRef: string) => `reverse:${reversalRef}`,

  /** Activation is keyed to the card and the funding event together, so a
   *  card can be re-activated after reissue without a key collision. */
  cardActivation: (cardId: string, fundingRef: string) => `activate:${cardId}:${fundingRef}`,

  /** One hold per authorization row. */
  authorizationHold: (authorizationId: string) => `auth:${authorizationId}`,

  /** One capture per authorization. Partial capture happens inside a single
   *  transaction: the captured amount goes to the vendor and the remainder
   *  returns to the card, together, atomically. */
  capture: (authorizationId: string) => `capture:${authorizationId}`,

  /** Void and capture are mutually exclusive outcomes of one authorization. */
  authorizationVoid: (authorizationId: string) => `void:${authorizationId}`,

  /** A card is invalidated once. */
  invalidationReclaim: (cardId: string) => `reclaim:${cardId}`,

  /** Reissue is keyed to the replacement card. */
  reissue: (toCardId: string) => `reissue:${toCardId}`,

  /** One settlement per vendor per period. */
  settlement: (merchantId: string, periodEnd: string) => `settle:${merchantId}:${periodEnd}`,

  /** Adjustments carry a human-supplied reference so the same correction
   *  cannot be applied twice by two admins. */
  adjustment: (ref: string) => `adjust:${ref}`,
}
