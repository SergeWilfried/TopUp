import { type SecurityState } from '../../api';
import { useApi } from '../../useApi';
import { SecHead } from '../../components/Bits';
import { Loaded } from '../../states';

/**
 * Whether the front door actually works.
 *
 * Every check here was failing in production while the dashboard looked
 * perfectly healthy: no OTP channel was configured, so the one account with
 * access could not sign in, and the only symptom was a code that never
 * arrived. None of these rows shows a secret's value — only whether one is
 * set — because "is it configured" is the question, and the answer should not
 * itself be worth stealing.
 */

const Check = ({ label, ok, detail, warn }: { label: string; ok: boolean; detail: string; warn?: boolean }) => (
  <div style={{ padding: '12px 0', borderTop: '1px solid var(--color-rule)' }}>
    <div className="row">
      <span className="k">{label}</span>
      <span className={`tag ${ok ? 'tag-neutral' : warn ? 'tag-outline' : 'tag-accent'}`}>
        {ok ? 'CONFIGURED' : 'NOT SET'}
      </span>
    </div>
    <p className="note" style={{ marginTop: 6 }}>
      {detail}
    </p>
  </div>
);

export default function Security() {
  const state = useApi<SecurityState>('/admin/security');
  const s = state.data;
  const noChannel = Boolean(s && !s.channels.email && !s.channels.sms);

  return (
    <>
      <SecHead
        title="Security"
        right={<span className="count">{s ? `${s.environment} · ${s.activeSessions} active sessions` : ''}</span>}
      />

      <Loaded loading={state.loading} error={state.error} onRetry={state.reload}>
        {noChannel && (
          <p className="note" style={{ color: 'var(--color-accent-800)', margin: '12px 0' }}>
            No sign-in codes can be delivered by any channel. Nobody can sign in to this console, or to the
            app, until one is configured.
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <Check
            label="Sign-in codes by email"
            ok={Boolean(s?.channels.email)}
            detail="RESEND_API_KEY. Without it the console sign-in returns not_configured and no code is sent."
          />
          <Check
            label="Sign-in codes by SMS"
            ok={Boolean(s?.channels.sms)}
            detail="Twilio Verify, or an account SID and auth token. This is how customers sign in to the app."
          />
          <Check
            label="Live SMS allowed"
            ok={Boolean(s?.liveSmsAllowed)}
            warn
            detail="ALLOW_LIVE_SMS. Off means codes are never actually sent, whatever else is configured — deliberate outside production."
          />
          <Check
            label="Agent signing key"
            ok={Boolean(s?.agentSigningKey)}
            detail="AGENT_SIGNING_KEY. VPN endpoints cannot mint agent tokens without it."
          />
        </div>

        <div className="rows" style={{ marginTop: 20 }}>
          <div className="row">
            <span className="k">Accounts with console access</span>
            <span className="figure num">{s?.staffCount ?? 0}</span>
          </div>
          <div className="row">
            <span className="k">Active sessions</span>
            <span className="figure num">{s?.activeSessions ?? 0}</span>
          </div>
        </div>

        <p className="note" style={{ marginTop: 16 }}>
          Sessions last 90 days and are stored as a hash, so a copy of the database yields nothing replayable.
          Revoke an individual account under Team.
        </p>
      </Loaded>
    </>
  );
}
