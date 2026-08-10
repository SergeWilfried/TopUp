import { useEffect, useState } from 'react';
import { fmt, fmtDate, fmtN } from '@topup/core';
import { formatMsisdn } from '../api';
import type { CustomerPage } from '../api';
import { useApi } from '../useApi';
import { KpiStrip, PageHead, Pager, SecHead, Seg } from '../components/Bits';
import { TableState } from '../states';
import CustomerDetail from './CustomerDetail';

const SORTS = ['spend', 'orders', 'joined', 'points', 'name'] as const;

export default function Customers() {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('spend');
  const [page, setPage] = useState(1);
  // A deep link from a transaction opens straight onto that customer.
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open'),
  );

  useEffect(() => setPage(1), [query, sort]);

  // `name` reads naturally A→Z; the numeric sorts want the biggest first.
  const order = sort === 'name' ? 'asc' : 'desc';
  const list = useApi<CustomerPage>('/admin/customers', { q: query, sort, order, page, perPage: 12 });
  const d = list.data;

  return (
    <>
      <PageHead
        kicker="Accounts"
        title={`${fmtN(d?.total ?? 0)} customers`}
        right={
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, MSISDN or ID…"
            aria-label="Search customers"
          />
        }
      />

      {/* Totals come from the response and describe the filtered set. */}
      <KpiStrip
        items={[
          { label: 'Lifetime value', value: fmt(d?.lifetimeValue ?? 0), sub: `across ${fmtN(d?.total ?? 0)} customers` },
          { label: 'Average per customer', value: fmt(d?.avgLifetime ?? 0), sub: 'lifetime' },
          {
            label: 'Repeat buyers',
            value: d ? `${d.repeatRate}%` : '—',
            sub: `${fmtN(d?.repeatBuyers ?? 0)} of ${fmtN(d?.total ?? 0)}`,
          },
          { label: 'Points outstanding', value: fmtN(d?.pointsOutstanding ?? 0), sub: 'redeemable' },
        ]}
      />

      <div className={selected ? 'split' : undefined}>
        <div>
        <SecHead title="All customers" right={<Seg options={SORTS} value={sort} onChange={setSort} />} />
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>CUSTOMER</th>
                <th>NETWORK</th>
                <th className="right">ORDERS</th>
                <th className="right">LIFETIME SPEND</th>
                <th className="right">POINTS</th>
                <th>JOINED</th>
              </tr>
            </thead>
            <tbody>
              {d?.rows.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(c.id)}
                  aria-selected={selected === c.id}
                >
                  <td>
                    <div className="lead">{c.name ?? 'Unnamed'}</div>
                    <div className="muted num">
                      {c.id} · {formatMsisdn(c.phone)}
                    </div>
                  </td>
                  <td>
                    <span className="tag tag-neutral">{c.carrier.toUpperCase()}</span>
                  </td>
                  <td className="right num">{fmtN(c.orders)}</td>
                  <td className="right figure num">{fmt(c.spend)}</td>
                  <td className="right muted num">{fmtN(c.points)}</td>
                  <td className="muted num">{fmtDate(c.joinedAt)}</td>
                </tr>
              ))}
              <TableState
                loading={list.loading}
                error={list.error}
                empty={d?.rows.length === 0}
                colSpan={6}
                onRetry={list.reload}
              />
            </tbody>
          </table>
        </div>
        {d && (
          <Pager
            page={d.page}
            pages={d.pages}
            label={`${(d.page - 1) * d.perPage + (d.total ? 1 : 0)}–${Math.min(d.page * d.perPage, d.total)} of ${d.total}`}
            onPage={setPage}
          />
        )}
        </div>

        {selected && (
          <CustomerDetail
            id={selected}
            onClose={() => setSelected(null)}
            onOpenOrder={(orderId) => {
              window.location.hash = `orders?open=${orderId}`;
            }}
          />
        )}
      </div>
    </>
  );
}
