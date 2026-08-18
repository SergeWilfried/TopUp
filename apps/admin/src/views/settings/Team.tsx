import { useState } from 'react';
import { ApiError, apiSend, type StaffRow } from '../../api';
import { useApi } from '../../useApi';
import { SecHead } from '../../components/Bits';
import { TableState } from '../../states';

const when = (ms: number | null) =>
  ms === null ? '—' : new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

/**
 * Who can open this console.
 *
 * Access is granted to an email address, which creates the account if it does
 * not exist yet; the invitee then signs in through the ordinary code flow and
 * is already staff. Waiting for them to sign in first and promoting them
 * afterwards cannot be bootstrapped — that is why the first account here had
 * to be written by hand against the production database.
 */
export default function Team() {
  const team = useApi<{ rows: StaffRow[] }>('/admin/team');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const message = (e: unknown) =>
    e instanceof ApiError
      ? e.code === 'email_invalid'
        ? 'That is not a valid email address.'
        : e.code === 'already_staff'
          ? 'That address already has access.'
          : e.code === 'cannot_revoke_self'
            ? 'You cannot remove your own access.'
            : e.code
      : 'network_error';

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      team.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    await run('invite', () => apiSend('POST', '/admin/team', { email }), `${email} can now sign in.`);
    setEmail('');
  };

  return (
    <>
      <SecHead
        title="Team"
        right={<span className="count">{team.data?.rows.length ?? 0} with console access</span>}
      />

      <div style={{ display: 'flex', gap: 8, margin: '12px 0 16px' }}>
        <input
          className="input"
          style={{ flex: '0 0 320px' }}
          type="email"
          placeholder="name@example.com"
          aria-label="Email address to grant access to"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && email && invite()}
        />
        <button className="btn btn-primary" type="button" disabled={!email || busy === 'invite'} onClick={invite}>
          {busy === 'invite' ? 'ADDING…' : 'GRANT ACCESS'}
        </button>
      </div>

      {error && <p className="note" style={{ color: 'var(--color-accent-800)' }}>{error}</p>}
      {notice && <p className="note">{notice}</p>}

      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th>EMAIL</th>
              <th>ADDED</th>
              <th className="right">SESSIONS</th>
              <th className="right">LAST SIGN-IN</th>
              <th className="right">ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {team.data?.rows.map((r) => (
              <tr key={r.id}>
                <td className="lead">
                  {r.email ?? r.msisdn ?? r.id}
                  {r.isSelf && <span className="count"> · you</span>}
                </td>
                <td className="muted num">{when(r.createdAt)}</td>
                <td className="right figure num">{r.sessions}</td>
                <td className="right muted num">
                  {/* Never signed in is worth seeing plainly: an account that
                      was granted access and could not use it is the shape of a
                      broken sign-in channel, not an idle colleague. */}
                  {r.lastSignIn === null ? <span className="tag tag-outline">NEVER</span> : when(r.lastSignIn)}
                </td>
                <td className="right">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy === `out-${r.id}` || r.sessions === 0}
                    onClick={() =>
                      run(`out-${r.id}`, () => apiSend('POST', `/admin/team/${r.id}/signout`, {}), 'Signed out.')
                    }
                  >
                    SIGN OUT
                  </button>{' '}
                  <button
                    className="btn btn-ghost"
                    type="button"
                    // Guarded on the server too; this only keeps the operator
                    // from reaching for a button that cannot work.
                    disabled={r.isSelf || busy === `rm-${r.id}`}
                    title={r.isSelf ? 'You cannot remove your own access' : undefined}
                    onClick={() =>
                      confirm(`Remove console access for ${r.email ?? r.id}?`) &&
                      run(`rm-${r.id}`, () => apiSend('DELETE', `/admin/team/${r.id}`, {}), 'Access removed.')
                    }
                  >
                    REMOVE
                  </button>
                </td>
              </tr>
            ))}
            <TableState
              loading={team.loading}
              error={team.error}
              empty={team.data?.rows.length === 0}
              colSpan={5}
              onRetry={team.reload}
            />
          </tbody>
        </table>
      </div>
    </>
  );
}
