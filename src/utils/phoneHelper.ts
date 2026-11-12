/**
 * Normalizes Bangladeshi (and general) phone numbers for consistent comparison.
 * Strips spaces, dashes, and parentheses, and converts +880 / 880 prefixes to leading 0.
 */
export const normalizeBDPhone = (phone: string): string => {
  const digits = (phone || '').replace(/[\s\-()]/g, '').trim();
  if (digits.startsWith('+880')) return '0' + digits.slice(4);
  if (digits.startsWith('880')) return '0' + digits.slice(3);
  return digits;
};

