export function isSixDigitMpin(value: string) {
  return /^\d{6}$/.test(value)
}

export function isValidCommissionPercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100
}