// Builds Supabase Auth's email templates (supabase/templates/*.html) from one
// layout, so every email Tusky sends looks the same. Run it after editing this
// file: `node scripts/build-auth-emails.mjs`. The output is what gets pasted
// into each project's dashboard (Auth -> Emails), so commit both.
//
// Rules (docs/ops/production.md):
// - The sign-in code email shows {{ .Token }} and no link. No subject or
//   preheader carries a code: both show on a lock screen.
// - Gmail strips custom-scheme links (tusky://), so a button only ever points
//   at an https address.
// - Table layout and inline styles only; Gmail drops <style> in some clients.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'templates');
const SITE = 'https://studiosouroboros.com/tusky';

// apps/mobile/src/constants/theme.ts, light palette.
const C = {
  paper: '#F7F4EC',
  card: '#FFFFFF',
  well: '#EFEBE0',
  line: '#E4DED0',
  ink: '#1F2A23',
  body: '#3D4A41',
  dim: '#5C6B60',
  brand: '#2F7B54',
  onBrand: '#FFFFFF',
};
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

const p = (html) =>
  `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:24px;color:${C.body};">${html}</p>`;

const small = (html) =>
  `<p style="margin:0 0 12px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.dim};">${html}</p>`;

const code = (token) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="t-well" align="center" style="background-color:${C.well};border:1px solid ${C.line};border-radius:12px;padding:20px 12px;">
      <span class="t-ink" style="font-family:${MONO};font-size:34px;line-height:40px;font-weight:600;letter-spacing:8px;color:${C.ink};">${token}</span>
    </td>
  </tr>
</table>`;

// Bulletproof button: the padding lives on the cell, so Outlook (Word) still
// draws a solid block, just with square corners.
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td class="t-btn" align="center" bgcolor="${C.brand}" style="background-color:${C.brand};border-radius:10px;">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:600;color:${C.onBrand};text-decoration:none;border-radius:10px;">${label}</a>
    </td>
  </tr>
</table>`;

const fallback = (href) =>
  small(
    `Button not working? Copy this link into your browser:<br><a href="${href}" target="_blank" style="color:${C.brand};text-decoration:underline;word-break:break-all;">${href}</a>`,
  );

function layout({ title, preheader, heading, body, why }) {
  const link = (href, label) =>
    `<a href="${href}" target="_blank" style="color:${C.dim};text-decoration:underline;">${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .t-paper { background-color: #121A15 !important; }
    .t-card { background-color: #1B2620 !important; border-color: #243229 !important; }
    .t-well { background-color: #243229 !important; border-color: #2E3E33 !important; }
    .t-ink, .t-ink a { color: #EFEAE0 !important; }
    .t-body, .t-body p { color: #C9CFC6 !important; }
    .t-dim, .t-dim p, .t-dim a { color: #94A198 !important; }
    .t-brand { color: #55C084 !important; }
    .t-btn { background-color: #3E9B6C !important; }
  }
  @media only screen and (max-width: 620px) {
    .t-pad { padding: 28px 22px !important; }
  }
</style>
</head>
<body class="t-paper" style="margin:0;padding:0;background-color:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" class="t-paper" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.paper}" style="background-color:${C.paper};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 20px;">
            <span class="t-brand" style="font-family:${SERIF};font-size:26px;line-height:32px;font-weight:700;color:${C.brand};letter-spacing:-0.3px;">Tusky</span>
          </td>
        </tr>
        <tr>
          <td class="t-card t-pad" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.line};border-radius:16px;padding:36px 36px 28px;">
            <h1 class="t-ink" style="margin:0 0 16px;font-family:${SERIF};font-size:26px;line-height:32px;font-weight:600;color:${C.ink};">${heading}</h1>
            <div class="t-body">
${body}
            </div>
          </td>
        </tr>
        <tr>
          <td class="t-dim" style="padding:24px 8px 0;">
            ${small(why)}
            ${small(`Tusky by Ouroboros Studios &middot; ${link(`${SITE}/privacy`, 'Privacy')} &middot; ${link(`${SITE}/terms`, 'Terms')} &middot; ${link(`${SITE}/support`, 'Support')}`)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

const sentTo = 'This email was sent to {{ .Email }}';

// `kind` decides where it lives in config.toml; subject is what goes in the
// dashboard's Subject field.
export const templates = {
  magic_link: {
    kind: 'template',
    subject: 'Your Tusky sign-in code',
    html: layout({
      title: 'Your Tusky sign-in code',
      preheader: 'Enter this code in Tusky to finish signing in. It expires in 1 hour.',
      heading: 'Your sign-in code',
      body: [
        p('Enter this code in the Tusky app to finish signing in.'),
        code('{{ .Token }}'),
        p('It expires in 1 hour and works once. Never share it: Tusky will never ask you for it by email, phone or text.'),
      ].join('\n'),
      why: `${sentTo} because someone tried to sign in to Tusky with it. If that wasn't you, you can ignore this email, but consider changing your password.`,
    }),
  },
  confirmation: {
    kind: 'template',
    subject: 'Confirm your email for Tusky',
    html: layout({
      title: 'Confirm your email for Tusky',
      preheader: 'One tap and your Tusky account is ready.',
      heading: 'Confirm your email',
      body: [
        p('Welcome to Tusky. Confirm this is your email address and your account is ready to use.'),
        button('{{ .ConfirmationURL }}', 'Confirm email'),
        p('Then go back to the app and sign in.'),
        fallback('{{ .ConfirmationURL }}'),
      ].join('\n'),
      why: `${sentTo} because it was used to create a Tusky account. If that wasn't you, you can ignore this email and no account will be created.`,
    }),
  },
  recovery: {
    kind: 'template',
    subject: 'Reset your Tusky password',
    html: layout({
      title: 'Reset your Tusky password',
      preheader: 'Use the code inside to choose a new password in Tusky.',
      heading: 'Reset your password',
      body: [
        p('Go back to Tusky, enter this code on the screen where you asked for the reset, then choose a new password.'),
        code('{{ .Token }}'),
        p('It expires in 1 hour and works once.'),
      ].join('\n'),
      why: `${sentTo} because someone asked to reset the Tusky password for it. If that wasn't you, you can ignore this email. Your password stays the same.`,
    }),
  },
  email_change: {
    kind: 'template',
    subject: 'Confirm your new email for Tusky',
    html: layout({
      title: 'Confirm your new email for Tusky',
      preheader: 'Confirm the change to your Tusky sign-in email.',
      heading: 'Confirm your new email',
      body: [
        p('You asked to change your Tusky email from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Confirm it to finish.'),
        button('{{ .ConfirmationURL }}', 'Confirm new email'),
        fallback('{{ .ConfirmationURL }}'),
      ].join('\n'),
      why: `This email was sent because a change of sign-in email was requested for a Tusky account. If that wasn't you, ignore this email and nothing will change, then change your password.`,
    }),
  },
  reauthentication: {
    kind: 'template',
    subject: 'Your Tusky verification code',
    html: layout({
      title: 'Your Tusky verification code',
      preheader: 'Enter this code in Tusky to confirm it is you.',
      heading: 'Confirm it\u2019s you',
      body: [
        p('Enter this code in the Tusky app to continue.'),
        code('{{ .Token }}'),
        p('It expires shortly and works once. Never share it with anyone.'),
      ].join('\n'),
      why: `${sentTo} because a sensitive change was started in Tusky. If that wasn't you, change your password.`,
    }),
  },
  invite: {
    kind: 'template',
    subject: 'You\u2019re invited to Tusky',
    html: layout({
      title: 'You\u2019re invited to Tusky',
      preheader: 'Accept your invitation to Tusky.',
      heading: 'You\u2019re invited',
      body: [
        p('You\u2019ve been invited to Tusky, the app for keeping your money in order. Accept the invitation to set up your account.'),
        button('{{ .ConfirmationURL }}', 'Accept invitation'),
        fallback('{{ .ConfirmationURL }}'),
      ].join('\n'),
      why: `${sentTo} because someone invited this address to Tusky. If you weren't expecting it, you can ignore this email.`,
    }),
  },
  password_changed_notification: {
    kind: 'notification',
    name: 'password_changed',
    subject: 'Your Tusky password was changed',
    html: layout({
      title: 'Your Tusky password was changed',
      preheader: 'The password for your Tusky account was just changed.',
      heading: 'Your password was changed',
      body: [
        p('The password for your Tusky account, <strong>{{ .Email }}</strong>, was just changed.'),
        p('If you did this, you\u2019re all set. If you didn\u2019t, reset your password now from the Tusky sign-in screen (<em>Forgot password?</em>) and contact us through the support page.'),
      ].join('\n'),
      why: `${sentTo} to let you know about a security change on your Tusky account.`,
    }),
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  const allowed = new Set(['.Token', '.TokenHash', '.ConfirmationURL', '.SiteURL', '.RedirectTo', '.Email', '.NewEmail']);
  for (const [name, t] of Object.entries(templates)) {
    // Lock-screen rule, the Gmail rule, and Supabase's variable names.
    if (/\{\{/.test(t.subject)) throw new Error(`${name}: a subject must not carry a template value`);
    if (/href="(?!https:\/\/|\{\{ \.ConfirmationURL \}\})/.test(t.html)) throw new Error(`${name}: every link must be https`);
    for (const [, v] of t.html.matchAll(/\{\{ *([^} ]+) *\}\}/g)) {
      if (!allowed.has(v)) throw new Error(`${name}: unknown template variable ${v}`);
    }
    if (name === 'magic_link' && /ConfirmationURL/.test(t.html)) throw new Error('magic_link shows the code, never a link');
    writeFileSync(join(OUT, `${name}.html`), t.html);
    console.log(`supabase/templates/${name}.html  subject: ${t.subject}`);
  }
}
