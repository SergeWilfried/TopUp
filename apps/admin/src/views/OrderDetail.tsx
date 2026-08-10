import { fmt, fmtDate } from '@topup/core';
import { providerLabel, type OrderDetail as Detail , formatMsisdn } from '../api';
import { useApi } from '../useApi';
import { OrderTag, Panel } from '../components/Bits';
import { Loaded } from '../states';

const time = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function OrderDetail({
  id,
  onClose,
  onOpenCustomer,
}: {
  id: string;
  onClose: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { data: d, loading, error, reload } = useApi<Detail>(`/admin/orders/${encodeURIComponent(id)}`);

  return (
    <Panel>
      <div className="panel-head">
        <div>
          <div className="kicker">Transaction</div>
          <h3 className="title num">{id}</h3>
          {d && <p className="sub num">{time(d.createdAt)}</p>}
        </div>
        <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <Loaded loading={loading} error={error} onRetry={reload}>
        {d && (
          <>
            <div className="rows" style={{ marginTop: 16 }}>
              <div className="row">
                <span className="k">Item</span>
                <span className="figure">{d.detail}</span>
              </div>
              <div className="row">
                <span className="k">Amount</span>
                <span className="figure num">{fmt(d.amount)}</span>
              </div>
              <div className="row">
                <span className="k">Method</span>
                <span className="figure">{providerLabel(d.method)}</span>
              </div>
              <div className="row">
                <span className="k">Status</span>
                <OrderTag status={d.status} />
              </div>
            </div>

            <h4>Progress</h4>
            <ol className="timeline">
              {d.timeline.map((t) => (
                <li key={t.step} className={t.done ? 'done' : 'pending'}>
                  {t.step}
                  <span className="when num">{t.done ? time(t.at) : 'not reached'}</span>
                </li>
              ))}
            </ol>

            {d.failureReason && (
              <p className="note" style={{ color: 'var(--color-accent)' }}>
                Failure reason: {d.failureReason}
              </p>
            )}

            <h4>Payment attempts</h4>
            <div className="minirows">
              {d.attempts.map((a) => (
                <div className="minirow" key={a.id}>
                  <span className="who">
                    {providerLabel(a.provider)} · <span className="num">{a.providerRef ?? '—'}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="num">{fmt(a.amount)}</span>
                    <span className={`tag ${a.status === 'captured' ? 'tag-neutral' : 'tag-outline'}`}>
                      {a.status.toUpperCase()}
                    </span>
                  </span>
                </div>
              ))}
              {d.attempts.length === 0 && <p className="note">No payment recorded.</p>}
            </div>

            <h4>Customer</h4>
            {d.customer ? (
              <>
                <div className="rows">
                  <div className="row">
                    <span className="k">{d.customer.name ?? 'Unnamed'}</span>
                    <span className="figure num">{formatMsisdn(d.customer.phone)}</span>
                  </div>
                  <div className="row">
                    <span className="k">Lifetime spend</span>
                    <span className="figure num">{fmt(d.customer.spend)}</span>
                  </div>
                  <div className="row">
                    <span className="k">Joined</span>
                    <span className="num">{fmtDate(d.customer.joinedAt)}</span>
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  style={{ marginTop: 12 }}
                  onClick={() => onOpenCustomer(d.customer!.id)}
                >
                  OPEN CUSTOMER →
                </button>
              </>
            ) : (
              <p className="note">No account is linked to this number.</p>
            )}

            {d.related.length > 0 && (
              <>
                <h4>Also bought</h4>
                <div className="minirows">
                  {d.related.map((r) => (
                    <div className="minirow" key={r.id}>
                      <span className="who">
                        <span className="num">{r.id}</span> · {r.detail}
                      </span>
                      <span className="num">{fmt(r.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Loaded>
    </Panel>
  );
}
