// Password rules for sign-up and password changes (Phase 15b, tightened in 16c).
// The server enforces the same minimum length and character classes (each
// project's Auth settings: lower, upper, digit, symbol); this checklist only
// says so before the round trip.

export const PASSWORD_MIN = 12;

export type PasswordRule = {
  id: 'length' | 'lower' | 'upper' | 'digit' | 'symbol' | 'email';
  label: string;
  ok: boolean;
};

/** Each rule with whether `password` meets it, in display order. */
export function passwordRules(password: string, email = ''): PasswordRule[] {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN },
    { id: 'lower', label: 'A lowercase letter', ok: /\p{Ll}/u.test(password) },
    { id: 'upper', label: 'An uppercase letter', ok: /\p{Lu}/u.test(password) },
    { id: 'digit', label: 'A number', ok: /\d/.test(password) },
    // Any character that is not a letter, a digit or whitespace.
    { id: 'symbol', label: 'A symbol', ok: /[^\p{L}\p{N}\s]/u.test(password) },
    {
      id: 'email',
      label: 'Not your email',
      ok: password.length > 0 && !(local.length >= 4 && password.toLowerCase().includes(local)),
    },
  ];
}

export function passwordOk(password: string, email = ''): boolean {
  return passwordRules(password, email).every((r) => r.ok);
}

/** The confirm field equals the password (and is not empty). */
export function passwordsMatch(password: string, confirm: string): boolean {
  return password.length > 0 && password === confirm;
}
