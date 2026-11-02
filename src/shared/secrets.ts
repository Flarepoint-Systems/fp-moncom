export const SECRET_PREFIX = 'enc:v1:';

export function isSealed(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX);
}
