import { fmt, fmtN } from '@topup/core';
import { formatMsisdn } from '../api';
import type { OrderPage, RailBalance, Stats } from '../api';
import { useApi } from '../useApi';
import { KpiStrip, OrderTag, PageHead, Panel, SecHead } from '../components/Bits';
import { Loaded, TableState } from '../states';

const time = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Dashboard() {
  const stats = useApi<Stats>('/admin/stats');
  const recent = useApi<OrderPage>('/admin/orders', { perPage: 10, sort: 'date', order: 'desc' });
  const float = useApi<{ rails: RailBalance[] }>('/admin/balances');

  const s = stats.data;
  const peak = Math.max(...(s?.revenueSeries ?? [0]), 1);
  const topProduct = Math.max(...(s?.revenueByProduct ?? []).map((r) => r.total), 1);

  return (
    <>
      <PageHead
        kicker="Overview"
        title={s ? `${fmt(s.revenue7)} this week` : 'Dashboard'}
        right={<span className="count">Live from the API</span>}
      />

      {s && (
        <KpiStrip
          items={[
            { label: 'Revenue · 7 days', value: fmt(s.revenue7), delta: s.revenueDelta, sub: 'vs previous 7' },
            { label: 'Orders · 7 days', value: fmtN(s.orders7), sub: `${fmtN(s.orders)} all time` },
            { label: 'Average order', value: fmt(s.avgOrder), sub: 'settled only' },
            // Turnover is what customers spent; this is what we kept.
            { label: 'Fees earned', value: fmt(s.fees), sub: 'all time' },
            { label: 'Failure rate', value: `${s.failureRate}%`, sub: `${s.pending} pending now` },
          ]}
        />
      )}

      <div className="split">
        <div>
          <SecHead title="Recent transactions" right={<span className="count">Latest 10</span>} />
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>REF</th>
                  <th>TIME</th>
                  <th>CUSTOMER</th>
                  <th>ITEM</th>
                  <th className="right">AMOUNT</th>
                  <th className="right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.rows.map((o) => (
                  <tr key={o.id}>
                    <td className="lead num">{o.id}</td>
                    <td className="muted num">{time(o.createdAt)}</td>
                    <td>
                      <div>{o.customer ?? 'Unknown'}</div>
                      <div className="muted num">{formatMsisdn(o.phone)}</div>
                    </td>
                    <td className="wrap">{o.detail}</td>
                    <td className="right figure num">{fmt(o.amount)}</td>
                    <td className="right">
                      <OrderTag status={o.status} />
                    </td>
                  </tr>
                ))}
                <TableState
                  loading={recent.loading}
                  error={recent.error}
                  empty={recent.data?.rows.length === 0}
                  colSpan={6}
                  onRetry={recent.reload}
                />
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <Panel title="Revenue · 14 days">
            <Loaded loading={stats.loading} error={stats.error} onRetry={stats.reload}>
              <div className="spark" role="img" aria-label="Daily settled revenue for the last 14 days">
                {(s?.revenueSeries ?? []).map((v, i) => (
                  <i
                    key={i}
                    className={i === (s?.revenueSeries.length ?? 0) - 1 ? 'last' : undefined}
                    style={{ height: `${Math.max((v / peak) * 100, 2)}%` }}
                  />
                ))}
              </div>
              <p className="note" style={{ marginTop: 12 }}>
                Peak {fmt(peak)} · total {fmt((s?.revenueSeries ?? []).reduce((a, b) => a + b, 0))}
              </p>
            </Loaded>
          </Panel>

          <Panel title="Sales by product">
            <Loaded loading={stats.loading} error={stats.error} onRetry={stats.reload}>
              <div className="dist" style={{ marginTop: 14 }}>
                {(s?.revenueByProduct ?? []).map((r) => (
                  <div className="dist-row" key={r.product}>
                    <span className="lead">{r.product}</span>
                    <span className="track">
                      <i style={{ width: `${(r.total / topProduct) * 100}%` }} />
                    </span>
                    <span className="val num">{Math.round((r.total / topProduct) * 100)}%</span>
                  </div>
                ))}
              </div>
            </Loaded>
          </Panel>

          {/* First in the stack on purpose. Distribution does not fail by
              breaking, it fails by running out of money: the APIs stay up, the
              app keeps taking orders, and every delivery bounces. Both rails
              are prepaid, so this is the panel that predicts tomorrow. */}
          <Panel title="Float · delivery rails">
            <Loaded loading={float.loading} error={float.error} onRetry={float.reload}>
              <div className="rows" style={{ marginTop: 12 }}>
                {(float.data?.rails ?? []).map((r) => (
                  <div key={r.rail}>
                    <div className="row">
                      <span className="k">{r.label}</span>
                      {r.status === 'ok' ? (
                        <span className="figure num">
                          {r.currency === 'XOF' || r.currency === undefined
                            ? fmt(r.amount ?? 0)
                            : `${(r.amount ?? 0).toFixed(2)} ${r.currency}`}
                        </span>
                      ) : (
                        // An unreachable rail and an unconfigured one are
                        // different problems: one needs a credential, the other
                        // needs a phone call. Never collapse them into "—".
                        <span className={r.status === 'not_configured' ? 'tag tag-neutral' : 'tag tag-accent'}>
                          {r.status === 'not_configured' ? 'NOT CONFIGURED' : 'UNREACHABLE'}
                        </span>
                      )}
                    </div>
                    {r.status === 'ok' && r.currency === 'EUR' && (
                      <p className="note">
                        ≈ {fmt(r.xof ?? 0)}
                        {typeof r.covers === 'number' ? ` · covers about ${fmtN(r.covers)} more eSIMs` : ''}
                      </p>
                    )}
                    {r.status === 'ok' && (r.balances?.length ?? 0) > 0 && (
                      <p className="note">
                        {r.balances!.map((b) => `${b.country} ${fmt(b.balance)}`).join(' · ')}
                      </p>
                    )}
                    {r.status === 'error' && r.error && <p className="note">{r.error}</p>}
                  </div>
                ))}
              </div>
            </Loaded>
          </Panel>

          <Panel title="Needs attention">
            <Loaded loading={stats.loading} error={stats.error} onRetry={stats.reload}>
              <div className="rows" style={{ marginTop: 12 }}>
                <div className="row">
                  <span className="k">VPN expiring ≤ 7 days</span>
                  <span className="figure num">{s?.expiringVpn ?? 0}</span>
                </div>
                <div className="row">
                  <span className="k">Payments pending</span>
                  <span className="figure num">{s?.pending ?? 0}</span>
                </div>
                <div className="row">
                  <span className="k">Refunded</span>
                  <span className="figure num">{s?.refunded ?? 0}</span>
                </div>
              </div>
            </Loaded>
          </Panel>
        </div>
      </div>
    </>
  );
}
