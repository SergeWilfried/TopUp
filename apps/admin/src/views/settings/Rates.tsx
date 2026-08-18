import { useState } from 'react';
import { ApiError, apiSend, type RateBook, type RateRow } from '../../api';
import { useApi } from '../../useApi';
import { SecHead } from '../../components/Bits';
import { TableState } from '../../states';

/**
 * The FX rate book.
 *
 * This screen exists because its absence was invisible. `fx_rates` was empty
 * on the deployed worker, the only writer refused to run in production, and
 * the effect was that every customer paying in dollars, pounds, naira,
 * shillings or rand was turned away at checkout with `no_fx_rate` — while the
 * dashboard showed nothing wrong at all. The euro worked only because the CFA
 * peg is hard-coded.
 *
 * So the table lists what the payment router can land on rather than what rows
 * happen to exist, and MISSING is a row you can see and fix.
 */

/** Operators quote "1 USD = 610 FCFA". Nobody quotes 0.001639. */
const fmtRate = (n: number | null) => (n === null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }));

export default function Rates() {
  const book = useApi<RateBook>('/admin/rates');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (r: RateRow) => {
    setEditing(r.currency);
    setDraft(r.xofPerUnit === null ? '' : String(r.xofPerUnit));
    setError(null);
  };

  const save = async (currency: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiSend<RateRow>('PUT', `/admin/rates/${currency}`, { xofPerUnit: Number(draft) });
      setEditing(null);
      book.reload();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'rate_out_of_range'
          ? 'That does not look like a rate. Enter how many FCFA one unit is worth.'
          : e instanceof ApiError && e.code === 'rate_is_pegged'
            ? 'Fixed by treaty — this one cannot be edited.'
            : e instanceof ApiError
              ? e.code
              : 'network_error',
      );
    } finally {
      setBusy(false);
    }
  };

  const missing = book.data?.missing ?? 0;

  return (
    <>
      <SecHead
        title="Exchange rates"
        right={
          <span className="count">
            {missing > 0
              ? `${missing} market${missing === 1 ? '' : 's'} cannot take payment`
              : '1 unit in FCFA'}
          </span>
        }
      />

      {/* Said plainly, because the symptom on the customer's side is a dead
          checkout button and nothing in the console previously connected the
          two. */}
      {missing > 0 && (
        <p className="note" style={{ marginBottom: 16, color: 'var(--color-accent-800)' }}>
          A currency with no rate is refused at checkout rather than charged at a guess. Those customers
          currently cannot pay at all.
        </p>
      )}
      {error && <p className="note" style={{ color: 'var(--color-accent-800)' }}>{error}</p>}

      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th>CURRENCY</th>
              <th>MARKETS</th>
              <th>RAIL</th>
              <th className="right">1 UNIT</th>
              <th className="right">UPDATED</th>
              <th className="right">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {book.data?.rows.map((r) => (
              <tr key={r.currency}>
                <td className="lead num">{r.currency}</td>
                <td className="wrap muted">{r.countries.join(' · ')}</td>
                <td className="muted">{r.provider}</td>
                <td className="right">
                  {editing === r.currency ? (
                    <input
                      className="input num"
                      style={{ width: 110, textAlign: 'right' }}
                      value={draft}
                      autoFocus
                      inputMode="decimal"
                      aria-label={`FCFA per 1 ${r.currency}`}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') save(r.currency);
                        if (e.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="figure num">{fmtRate(r.xofPerUnit)}</span>
                  )}
                </td>
                <td className="right muted num">
                  {r.ageDays === null ? '—' : r.ageDays === 0 ? 'today' : `${r.ageDays}d ago`}
                </td>
                <td className="right">
                  {editing === r.currency ? (
                    <>
                      <button className="btn" type="button" disabled={busy} onClick={() => save(r.currency)}>
                        {busy ? 'SAVING…' : 'SAVE'}
                      </button>{' '}
                      <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>
                        CANCEL
                      </button>
                    </>
                  ) : r.pegged ? (
                    // Fixed by treaty at 655.957. Not an operator's decision.
                    <span className="tag tag-neutral">PEGGED</span>
                  ) : (
                    <button
                      className={`tag ${r.status === 'missing' ? 'tag-accent' : r.status === 'stale' ? 'tag-outline' : 'tag-neutral'}`}
                      type="button"
                      onClick={() => open(r)}
                      aria-label={`Set the rate for ${r.currency}`}
                    >
                      {r.status === 'missing' ? 'MISSING' : r.status === 'stale' ? 'STALE' : 'SET'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <TableState
              loading={book.loading}
              error={book.error}
              empty={book.data?.rows.length === 0}
              colSpan={6}
              onRetry={book.reload}
            />
          </tbody>
        </table>
      </div>

      <p className="note" style={{ marginTop: 14 }}>
        Rates are entered by hand and do not track the market. A stale rate quietly loses money on every
        sale, so anything past a week is flagged.
      </p>
    </>
  );
}
