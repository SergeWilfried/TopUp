import { fmt, fmtDate, fmtN } from '@topup/core';
import { formatMsisdn } from '../api';
import type { CustomerDetail as Detail } from '../api';
import { useApi } from '../useApi';
import { OrderTag, Panel } from '../components/Bits';
import { Loaded } from '../states';

export default function CustomerDetail({
  id,
  onClose,
  onOpenOrder,
}: {
  id: string;
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { data: d, loading, error, reload } = useApi<Detail>(`/admin/customers/${encodeURIComponent(id)}`);
  const peak = Math.max(...(d?.breakdown ?? []).map((b) => b.total), 1);

  return (
    <Panel>
      <div className="panel-head">
        <div>
          <div className="kicker">Customer</div>
          <h3 className="title">{d?.name ?? id}</h3>
          {d && (
            <p className="sub num">
              {d.id} · {formatMsisdn(d.phone)}
            </p>
          )}
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
                <span className="k">Network</span>
                <span className="figure">{d.carrier}</span>
              </div>
              <div className="row">
                <span className="k">Lifetime spend</span>
                <span className="figure num">{fmt(d.spend)}</span>
              </div>
              <div className="row">
                <span className="k">Average order</span>
                <span className="figure num">{fmt(d.totals.avgOrder)}</span>
              </div>
              <div className="row">
                <span className="k">Points</span>
                <span className="figure num">{fmtN(d.points)}</span>
              </div>
              <div className="row">
                <span className="k">Joined</span>
                <span className="num">{fmtDate(d.joinedAt)}</span>
              </div>
              <div className="row">
                <span className="k">Last order</span>
                <span className="num">{d.totals.lastOrderAt ? fmtDate(d.totals.lastOrderAt) : '—'}</span>
              </div>
              {(d.totals.pending > 0 || d.totals.failed > 0) && (
                <div className="row">
                  <span className="k">Needs attention</span>
                  <span className="figure num">
                    {d.totals.pending} pending · {d.totals.failed} failed
                  </span>
                </div>
              )}
            </div>

            {d.breakdown.length > 0 && (
              <>
                <h4>What they buy</h4>
                <div className="dist">
                  {d.breakdown.map((b) => (
                    <div className="dist-row" key={b.product}>
                      <span className="lead">{b.product}</span>
                      <span className="track">
                        <i style={{ width: `${(b.total / peak) * 100}%` }} />
                      </span>
                      <span className="val num">{b.count}×</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <h4>Recent orders</h4>
            <div className="minirows">
              {d.recent.map((o) => (
                <div className="minirow" key={o.id}>
                  <span className="who">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      style={{ padding: 0, fontSize: 12 }}
                      onClick={() => onOpenOrder(o.id)}
                    >
                      {o.id}
                    </button>{' '}
                    · {o.detail}
                  </span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="num">{fmt(o.amount)}</span>
                    <OrderTag status={o.status} />
                  </span>
                </div>
              ))}
              {d.recent.length === 0 && <p className="note">No orders yet.</p>}
            </div>
          </>
        )}
      </Loaded>
    </Panel>
  );
}
