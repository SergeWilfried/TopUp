import { useState } from 'react';
import { fmt, fmtN } from '@topup/core';
import { ApiError, apiSend, type Fleet } from '../../api';
import { useApi } from '../../useApi';
import { KpiStrip, SecHead } from '../../components/Bits';
import { Loaded, TableState } from '../../states';
import { Modal } from '../../components/Modal';
import AgentDetail from './AgentDetail';

/**
 * The phone farm.
 *
 * A bench of handsets is opaque from across the room: every one shows a
 * notification saying what it is doing, and reading eight of them one at a time
 * is not monitoring. This is the screen that answers the questions that matter
 * from a desk — is anything queued, is anything stuck, and has a SIM quietly
 * stopped talking.
 */

/** A device polls every fifteen seconds when idle, so five minutes is dead. */
const STALE_MS = 5 * 60_000;

const ago = (ms: number | null) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export default function Fleet() {
  const fleet = useApi<Fleet>('/admin/agents');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ id: string; token: string } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [form, setForm] = useState({ msisdn: '', carrier: '', country: 'BF', label: '', dailyCap: '' });

  const d = fleet.data;
  const unknown = d?.queue.unknown ?? 0;
  // A route with SIMs and no script is a bench that will never dispatch.
  const brokenRoutes = (d?.routes ?? []).filter((r) => r.scriptVersion === null && r.activeAgents > 0);

  const enrol = async () => {
    setBusy('enrol');
    setNote(null);
    try {
      const r = await apiSend<{ id: string; token: string }>('POST', '/admin/agents', {
        msisdn: form.msisdn,
        carrier: form.carrier,
        country: form.country,
        label: form.label || undefined,
        dailyCap: form.dailyCap ? Number(form.dailyCap) : undefined,
      });
      setIssued(r);
      setEnrolling(false);
      setForm({ msisdn: '', carrier: '', country: form.country, label: '', dailyCap: '' });
      fleet.reload();
    } catch (e) {
      setNote(
        e instanceof ApiError && e.code === 'msisdn_already_enrolled'
          ? 'That number is already on the bench.'
          : e instanceof ApiError
            ? e.code
            : 'network_error',
      );
    } finally {
      setBusy(null);
    }
  };

  const disable = async (id: string, label: string) => {
    if (!confirm(`Retire ${label}? Jobs it already holds run their course or expire to unknown.`)) return;
    setBusy(id);
    try {
      await apiSend('POST', `/admin/agents/${id}/disable`, {});
      fleet.reload();
    } catch (e) {
      setNote(e instanceof ApiError ? e.code : 'network_error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Loaded loading={fleet.loading} error={fleet.error} onRetry={fleet.reload}>
        {d && (
          <KpiStrip
            items={[
              { label: 'Queued', value: fmtN(d.queue.queued ?? 0), sub: 'waiting for a device' },
              { label: 'In flight', value: fmtN(d.queue.leased ?? 0), sub: 'being typed now' },
              // The one an operator has to act on: the worker will never retry
              // these, by design, so they sit until a person resolves them.
              { label: 'Needs checking', value: fmtN(unknown), sub: 'never auto-retried' },
              {
                label: 'Float on bench',
                value: fmt(d.agents.reduce((sum, a) => sum + (a.floatBalance ?? 0), 0)),
                sub: 'last reported',
              },
            ]}
          />
        )}

        {/* Said loudly, because nothing else on any screen reveals it: these
            devices will poll for ever and dispatch nothing. */}
        {brokenRoutes.length > 0 && (
          <p className="note" style={{ color: 'var(--color-accent-800)', marginTop: 16 }}>
            No USSD menu published for {brokenRoutes.map((r) => `${r.country}/${r.carrier}`).join(', ')}. SIMs on{' '}
            {brokenRoutes.length === 1 ? 'that route' : 'those routes'} cannot dispatch until a script exists.
          </p>
        )}

        <SecHead
          title="SIMs"
          right={
            <button className="btn btn-primary" type="button" onClick={() => { setNote(null); setEnrolling(true); }}>
              ENROL A SIM
            </button>
          }
        />
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>SIM</th>
                <th>ROUTE</th>
                <th className="right">FLOAT</th>
                <th className="right">TODAY</th>
                <th className="right">IN FLIGHT</th>
                <th className="right">LAST SEEN</th>
                <th className="right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {d?.agents.map((a) => {
                const stale = a.active === 1 && (!a.lastSeen || Date.now() - a.lastSeen > STALE_MS);
                const capped = a.dailyCap !== null && a.dailyCount >= a.dailyCap;
                return (
                  <tr key={a.id} onClick={() => setViewing(a.id)} style={{ cursor: 'pointer' }}>
                    <td className="lead">
                      {a.label || a.msisdn}
                      <div className="muted num">{a.msisdn}</div>
                    </td>
                    <td>
                      {a.country} · {a.carrier}
                      {a.active !== 1 && <span className="count"> · retired</span>}
                    </td>
                    <td className="right figure num">{a.floatBalance === null ? '—' : fmt(a.floatBalance)}</td>
                    <td className="right num">
                      <span className={capped ? 'figure bad' : 'figure'}>{a.dailyCount}</span>
                      <span className="muted">{a.dailyCap === null ? '' : ` / ${a.dailyCap}`}</span>
                    </td>
                    <td className="right figure num">{a.inFlight}</td>
                    <td className="right num">
                      {stale ? (
                        // A silent SIM is the failure that looks like nothing:
                        // orders queue, nobody dispatches, no error anywhere.
                        <span className="tag tag-accent">{ago(a.lastSeen)}</span>
                      ) : (
                        <span className="muted">{ago(a.lastSeen)}</span>
                      )}
                    </td>
                    <td className="right">
                      {a.active === 1 && (
                        <button
                          className="btn btn-ghost"
                          type="button"
                          disabled={busy === a.id}
                          onClick={(e) => { e.stopPropagation(); disable(a.id, a.label || a.msisdn); }}
                        >
                          RETIRE
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <TableState
                loading={fleet.loading}
                error={fleet.error}
                empty={d?.agents.length === 0}
                colSpan={7}
                onRetry={fleet.reload}
              />
            </tbody>
          </table>
        </div>

        {enrolling && (
          <Modal kicker="Bench" title="Enrol a SIM" onClose={() => setEnrolling(false)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="input" placeholder="SIM number"
                     value={form.msisdn} onChange={(e) => setForm({ ...form, msisdn: e.target.value })} />
              <input className="input" placeholder="Carrier (Orange)"
                     value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} />
              <input className="input" placeholder="Country (BF)"
                     value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />
              <input className="input" placeholder="Label (Bench 1)"
                     value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <input className="input" placeholder="Daily transfer cap"
                     value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: e.target.value })} />
            </div>
            {note && <p className="note" style={{ color: 'var(--color-accent-800)' }}>{note}</p>}
            <div className="dialog-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setEnrolling(false)}>CANCEL</button>
              <button className="btn btn-primary" type="button"
                      disabled={!form.msisdn || !form.carrier || busy === 'enrol'} onClick={enrol}>
                {busy === 'enrol' ? 'ENROLLING…' : 'ENROL'}
              </button>
            </div>
          </Modal>
        )}

        {/* Only the hash is stored, so this is the one time it can be read.
            Losing it means enrolling the handset again, which is the right
            trade for a credential that can spend float. */}
        {issued && (
          <Modal kicker="Agent token" title="Copy this into the handset now" onClose={() => setIssued(null)}>
            <p className="figure num" style={{ wordBreak: 'break-all' }}>{issued.token}</p>
            <p className="note">
              Stored as a hash — it cannot be shown again. If it is lost, retire this SIM and enrol it afresh.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-primary" type="button" onClick={() => setIssued(null)}>DONE</button>
            </div>
          </Modal>
        )}

        {viewing && <AgentDetail id={viewing} onClose={() => setViewing(null)} />}
      </Loaded>
    </>
  );
}
