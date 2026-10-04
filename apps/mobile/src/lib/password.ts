// Password rules for sign-up (Phase 15b). The server enforces the same minimum
// length and "letters and digits" (each project's Auth settings); this checklist
// only says so before the round trip.

export const PASSWORD_MIN = 10;

export type PasswordRule = { id: 'length' | 'letter' | 'digit' | 'email'; label: string; ok: boolean };

/** Each rule with whether `password` meets it, in display order. */
export function passwordRules(password: string, email = ''): PasswordRule[] {
  const local = email.trim().toLowerCase().split('@')[0] ?? '';
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN },
    { id: 'letter', label: 'A letter', ok: /\p{L}/u.test(password) },
    { id: 'digit', label: 'A number', ok: /\d/.test(password) },
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
