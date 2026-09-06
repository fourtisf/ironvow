import { createTransport, type Transporter } from 'nodemailer';
import { env } from './env.js';

/**
 * Login-link delivery.
 *
 * Until this existed the game had a SAVE IT button that sent a link nobody ever
 * received: guest play hid the gap, but a player changing phone lost their hold
 * for good. The console transport is still the default for development, and
 * production refuses to start with it rather than dropping mail silently.
 */

let transporter: Transporter | null = null;

function smtp(): Transporter {
  if (transporter) return transporter;
  const config = env();
  transporter = createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // Port 465 is implicit TLS; everything else negotiates with STARTTLS.
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface LinkMail {
  to: string;
  link: string;
  /** A player attaching an email to a hold they are already playing. */
  claiming: boolean;
}

function body({ link, claiming }: LinkMail): { subject: string; text: string; html: string } {
  const subject = claiming ? 'Keep your IRONVOW hold' : 'Your IRONVOW sign-in link';
  const lead = claiming
    ? 'Open this to attach your email to the hold you are already playing. Nothing in the game changes; it just stops being tied to one browser.'
    : 'Open this to sign in. It works once and expires in fifteen minutes.';

  const text = `IRONVOW\n\n${lead}\n\n${link}\n\nIf you did not ask for this, ignore it — nothing happens until the link is opened.\n`;

  // Deliberately plain. Mail clients mangle anything ambitious, and a login
  // link that renders as a wall of broken markup looks like a phishing attempt.
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#1b2432;font-family:Arial,Helvetica,sans-serif;color:#f2e4c4">
  <div style="max-width:440px;margin:0 auto;background:#22304a;border:2px solid #e8b23c;border-radius:16px;padding:24px">
    <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:2px">IRONVOW</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#c3d4ea">${lead}</p>
    <p style="margin:0 0 20px">
      <a href="${link}" style="display:inline-block;background:#e8b23c;color:#3a2708;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;font-size:14px">${claiming ? 'KEEP MY HOLD' : 'SIGN IN'}</a>
    </p>
    <p style="margin:0;font-size:11px;line-height:1.6;color:#8fa6c4">If you did not ask for this, ignore it — nothing happens until the link is opened.</p>
  </div>
</body></html>`;

  return { subject, text, html };
}

/**
 * Send a login link.
 *
 * Throws on a transport failure rather than swallowing it, so the route can
 * answer honestly instead of telling the player to check an inbox that will
 * stay empty.
 */
/** Thrown when this server has no way to send mail at all. */
export class MailOff extends Error {
  constructor() {
    super('MAIL_TRANSPORT=off: this server does not send email');
    this.name = 'MailOff';
  }
}

export function mailIsOff(): boolean {
  return env().MAIL_TRANSPORT === 'off';
}

export async function sendLoginLink(mail: LinkMail): Promise<void> {
  const config = env();
  if (config.MAIL_TRANSPORT === 'off') throw new MailOff();
  const { subject, text, html } = body(mail);

  if (config.MAIL_TRANSPORT === 'console') {
    // Development only; env() refuses to let this run in production.
    // eslint-disable-next-line no-console
    console.log(`\n[mail] to=${mail.to}\n[mail] ${subject}\n[mail] ${mail.link}\n`);
    return;
  }

  await smtp().sendMail({ from: config.MAIL_FROM, to: mail.to, subject, text, html });
}

/** Startup check, so a broken SMTP configuration fails loudly at boot. */
export async function verifyMail(): Promise<void> {
  if (env().MAIL_TRANSPORT !== 'smtp') return;
  await smtp().verify();
}
