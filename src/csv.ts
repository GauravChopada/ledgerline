/**
 * Quotes a field when it contains a quote, a line break or a character a spreadsheet may treat as
 * the separator: Excel splits on the locale's list separator, which is `;` in much of Europe.
 */
export function csvField(value: string): string {
  return /[",;\t\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function csvRow(fields: readonly string[]): string {
  return `${fields.map(csvField).join(',')}\r\n`;
}

/**
 * Free text that a spreadsheet would evaluate as a formula (leading =, +, -, @, tab or carriage
 * return) gets a leading apostrophe so it is displayed as text. See OWASP "CSV Injection".
 */
export function plainText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Non-negative integer cents as a decimal string, e.g. 123456 -> "1234.56". Exact for any safe integer. */
export function formatAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`not a cent amount: ${cents}`);
  const digits = String(cents).padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
