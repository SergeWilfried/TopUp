import { useState } from 'react';
import { ApiError } from '../api';
import { requestCode, verifyCode, type Session } from '../auth';

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

const MESSAGES: Record<string, string> = {
  not_staff: 'That account is not a staff account.',
  invalid_code: 'Wrong or expired code.',
  too_many_requests: 'Too many codes requested. Try again in a few minutes.',
  network_error: 'Could not reach the API.',
};

/** Passwordless staff sign-in, using the same OTP flow customers use. */
export default function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const key = e instanceof ApiError ? e.code : 'network_error';
    setError(MESSAGES[key] ?? key);
    setBusy(false);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestCode(email.trim().toLowerCase());
      setStep('code');
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await verifyCode(email.trim().toLowerCase(), code.trim()));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="signin">
      <div className="panel">
        <div className="body">
          <div className="brand" style={{ marginBottom: 18 }}>
            TOPUP<span className="dot">.</span> <span className="sub">Admin</span>
          </div>

          {step === 'email' ? (
            <>
              <div className="kicker">Staff sign-in</div>
              <h2 className="title">Enter your work email</h2>
              <p className="note" style={{ margin: '8px 0 16px' }}>
                We send a six-digit code. No password to lose.
              </p>
              <div className="field">
                <label htmlFor="signin-email">Email</label>
                <input
                  id="signin-email"
                  className="input"
                  type="email"
                  value={email}
                  autoFocus
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && looksLikeEmail(email) && !busy && send()}
                  placeholder="ops@tofee.app"
                />
              </div>
              <button
                className="btn btn-primary"
                type="button"
                style={{ marginTop: 16, width: '100%' }}
                disabled={!looksLikeEmail(email) || busy}
                onClick={send}
              >
                {busy ? 'SENDING…' : 'SEND CODE →'}
              </button>
            </>
          ) : (
            <>
              <div className="kicker">Check your inbox</div>
              <h2 className="title">Enter the code</h2>
              <p className="note" style={{ margin: '8px 0 16px' }}>
                Sent to {email}. It expires in ten minutes.
              </p>
              <div className="field">
                <label htmlFor="signin-code">Six-digit code</label>
                <input
                  id="signin-code"
                  className="input code"
                  value={code}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && !busy && verify()}
                  placeholder="000000"
                />
              </div>
              <button
                className="btn btn-primary"
                type="button"
                style={{ marginTop: 16, width: '100%' }}
                disabled={code.length !== 6 || busy}
                onClick={verify}
              >
                {busy ? 'CHECKING…' : 'SIGN IN →'}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setStep('email');
                  setCode('');
                  setError(null);
                }}
              >
                ← USE A DIFFERENT EMAIL
              </button>
            </>
          )}

          {error && (
            <p className="note" style={{ color: 'var(--color-accent)', marginTop: 14 }} role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
