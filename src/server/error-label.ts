/**
 * What a log line may say about a caught error: its name and code, never its message. A Prisma
 * error's message prints the call's arguments (an email address, a name, a phone number).
 */
export function errorLabel(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as {code?: unknown}).code;
  return `${err.name}${typeof code === 'string' || typeof code === 'number' ? ` ${code}` : ''}`;
}
