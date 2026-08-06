/**
 * Whole baht only. Hand-rolled grouping rather than Intl.NumberFormat because
 * Hermes ships a reduced ICU and the baht sign placement varies by build.
 */
export function formatBaht(baht: number): string {
  const rounded = Math.round(baht);
  const negative = rounded < 0;
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}฿${grouped}`;
}

/** "+฿10" / "free" — how an option's price change reads next to its name. */
export function formatDelta(baht: number): string {
  if (baht === 0) return '';
  return `${baht > 0 ? '+' : '−'}${formatBaht(Math.abs(baht))}`;
}
