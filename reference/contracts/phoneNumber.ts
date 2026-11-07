/** Canonicalize recognizable numbers without guessing at incomplete or foreign local numbers. */
export function normalizePhone(value: string): string {
  const text = value.trim();
  const digits = text.replace(/\D/g, "");
  // An explicit country code takes precedence over the ten-digit US shortcut.
  // Otherwise a valid +44 number with ten total digits could become +144... .
  if (/^\+[\d().\s-]+$/.test(text))
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : text;
  if (!/^[()\d.\s-]+$/.test(text)) return text;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return text;
}
