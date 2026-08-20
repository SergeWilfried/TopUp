import { useState } from 'react';
import { ApiError, apiSend, type UssdScript, type UssdStep } from '../../api';
import { useApi } from '../../useApi';
import { Modal } from '../../components/Modal';
import { SecHead } from '../../components/Bits';
import { TableState } from '../../states';
import StepEditor, { stepsAreValid } from './StepEditor';

/**
 * The USSD menus.
 *
 * One per market and operator, **not** per SIM — the menu belongs to the
 * operator, so every Orange SIM in Burkina types the same sequence. Storing it
 * per handset would mean the same steps copied a dozen times, drifting apart,
 * and a menu change becoming a dozen edits instead of one.
 *
 * These are edited during an incident: the operator reorders their menu, every
 * dispatch starts failing, and someone has to fix it quickly and correctly. So
 * the editor shows what the device will actually receive, and the worker
 * refuses anything malformed rather than letting a broken script reach a
 * handset that would type it into a live prompt holding real money.
 */

const time = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short' });

/** Stored steps, or an empty sequence if the row is somehow unreadable. */
function safeSteps(json: string): UssdStep[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as UssdStep[]) : [];
  } catch {
    return [];
  }
}

/** A plausible shape to start from, not a menu that is known to work. */
const TEMPLATE: UssdStep[] = [
  { expect: '1\\. Transfert', send: '1' },
  { expect: 'Numero', send: '{msisdn}' },
  { expect: 'Montant', send: '{amount}' },
  { expect: 'code secret', send: '{pin}' },
  { expect: 'Confirmer', send: '1' },
];

type Draft = { country: string; carrier: string; entry: string; steps: UssdStep[]; successRe: string };

const EMPTY: Draft = { country: 'BF', carrier: '', entry: '*144#', steps: TEMPLATE, successRe: '' };

export default function Scripts() {
  const list = useApi<{ scripts: UssdScript[] }>('/admin/scripts');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (s?: UssdScript) =>
    setDraft(
      s
        ? {
            country: s.country,
            carrier: s.carrier,
            entry: s.entry,
            // Stored as a JSON string; edited as a sequence.
            steps: safeSteps(s.steps),
            successRe: s.successRe ?? '',
          }
        : { ...EMPTY },
    );

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend('PUT', `/admin/scripts/${draft.country}/${encodeURIComponent(draft.carrier)}`, {
        entry: draft.entry,
        steps: draft.steps,
        successRe: draft.successRe || undefined,
      });
      setDraft(null);
      list.reload();
    } catch (e) {
      // The worker validates each step's regex and shape; surface which one.
      setError(e instanceof ApiError ? e.code.replace(/_/g, ' ') : 'network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SecHead
        title="USSD menus"
        right={
          <button className="btn btn-primary" type="button" onClick={() => open()}>
            NEW MENU
          </button>
        }
      />
      <p className="note" style={{ margin: '10px 0 14px' }}>
        One menu per operator and market — every SIM on that route types the same steps.{' '}
        <strong>{'{msisdn}'}</strong>, <strong>{'{amount}'}</strong> and <strong>{'{pin}'}</strong> are substituted on
        the handset; the PIN never leaves it.
      </p>

      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th>ROUTE</th>
              <th>ENTRY</th>
              <th className="right">STEPS</th>
              <th className="right">VERSION</th>
              <th className="right">UPDATED</th>
              <th className="right"></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.scripts.map((s) => {
              const count = safeSteps(s.steps).length;
              return (
                <tr key={`${s.country}/${s.carrier}`}>
                  <td className="lead">
                    {s.country} · {s.carrier}
                  </td>
                  <td className="num">{s.entry}</td>
                  <td className="right figure num">{count || '—'}</td>
                  <td className="right figure num">v{s.version}</td>
                  <td className="right muted num">{time(s.updatedAt)}</td>
                  <td className="right">
                    <button className="btn btn-ghost" type="button" onClick={() => open(s)}>
                      EDIT
                    </button>
                  </td>
                </tr>
              );
            })}
            <TableState
              loading={list.loading}
              error={list.error}
              empty={list.data?.scripts.length === 0}
              colSpan={6}
              onRetry={list.reload}
            />
          </tbody>
        </table>
      </div>

      {draft && (
        <Modal
          kicker="USSD menu"
          title={draft.carrier ? `${draft.country} · ${draft.carrier}` : 'New menu'}
          wide
          onClose={() => setDraft(null)}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              style={{ width: 80 }}
              placeholder="BF"
              value={draft.country}
              onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })}
            />
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Carrier (Orange)"
              value={draft.carrier}
              onChange={(e) => setDraft({ ...draft, carrier: e.target.value })}
            />
            <input
              className="input"
              style={{ width: 120 }}
              placeholder="*144#"
              value={draft.entry}
              onChange={(e) => setDraft({ ...draft, entry: e.target.value })}
            />
          </div>

          <label className="note" style={{ marginTop: 12, display: 'block' }}>
            Steps, in order. Each pattern is matched against the dialog on screen; a dialog matching nothing aborts the
            session rather than being answered.
          </label>
          <StepEditor steps={draft.steps} onChange={(steps) => setDraft({ ...draft, steps })} />

          <label className="note" style={{ marginTop: 8, display: 'block' }}>
            Receipt pattern — matches the operator&rsquo;s confirmation SMS. Without it a transfer can never be
            confirmed and every job ends as unknown.
          </label>
          <input
            className="input num"
            style={{ width: '100%' }}
            placeholder="Transfert de .* effectue"
            value={draft.successRe}
            onChange={(e) => setDraft({ ...draft, successRe: e.target.value })}
          />

          {error && (
            <p className="note" style={{ color: 'var(--color-accent-800)' }}>
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={() => setDraft(null)}>
              CANCEL
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || !draft.carrier || !draft.country || !stepsAreValid(draft.steps)}
              onClick={save}
            >
              {busy ? 'PUBLISHING…' : 'PUBLISH'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
