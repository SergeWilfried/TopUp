import { useEffect, useState } from 'react';
import { fmt, fmtN } from '@topup/core';
import { providerLabel, type OrderPage, type Stats , formatMsisdn } from '../api';
import { useApi } from '../useApi';
import { KpiStrip, OrderTag, PageHead, Pager, SecHead, Seg } from '../components/Bits';
import { TableState } from '../states';
import OrderDetail from './OrderDetail';

const STATUSES = ['all', 'delivered', 'pending', 'failed', 'refunded'] as const;
const PRODUCTS = ['all', 'airtime', 'data', 'esim', 'vpn'] as const;

const time = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Orders() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [product, setProduct] = useState<(typeof PRODUCTS)[number]>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  // A deep link from a customer opens straight onto that transaction.
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('open'),
  );

  // Any change to the filters invalidates the current page number.
  useEffect(() => setPage(1), [status, product, query]);

  const stats = useApi<Stats>('/admin/stats');
  const list = useApi<OrderPage>('/admin/orders', { status, product, q: query, page, perPage: 12 });
  const d = list.data;

  return (
    <>
      <PageHead
        kicker="Transactions"
        title={`${fmtN(stats.data?.orders ?? 0)} orders`}
        right={
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ref, customer or MSISDN…"
            aria-label="Search transactions"
          />
        }
      />

      <KpiStrip
        items={[
          { label: 'Settled · shown', value: fmt(d?.settled ?? 0), sub: `${fmtN(d?.total ?? 0)} rows` },
          { label: 'Revenue · all time', value: fmt(stats.data?.revenue ?? 0), sub: 'delivered only' },
          { label: 'Average order', value: fmt(stats.data?.avgOrder ?? 0), sub: 'settled only' },
          { label: 'Failure rate', value: `${stats.data?.failureRate ?? 0}%`, sub: 'failed + refunded' },
        ]}
      />

      <div className={selected ? 'split' : undefined}>
        <div>
        <SecHead
          title="All transactions"
          right={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Seg options={PRODUCTS} value={product} onChange={setProduct} />
              <Seg options={STATUSES} value={status} onChange={setStatus} />
            </div>
          }
        />
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>REF</th>
                <th>TIME</th>
                <th>CUSTOMER</th>
                <th>TYPE</th>
                <th>ITEM</th>
                <th>METHOD</th>
                <th className="right">AMOUNT</th>
                <th className="right">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {d?.rows.map((o) => (
                <tr
                  key={o.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(o.id)}
                  aria-selected={selected === o.id}
                >
                  <td className="lead num">{o.id}</td>
                  <td className="muted num">{time(o.createdAt)}</td>
                  <td>
                    <div>{o.customer ?? 'Unknown'}</div>
                    <div className="muted num">{formatMsisdn(o.phone)}</div>
                  </td>
                  <td>
                    <span className="tag tag-neutral">{o.product.toUpperCase()}</span>
                  </td>
                  <td className="wrap">{o.detail}</td>
                  <td className="muted">{providerLabel(o.method)}</td>
                  <td className="right figure num">{fmt(o.amount)}</td>
                  <td className="right">
                    <OrderTag status={o.status} />
                  </td>
                </tr>
              ))}
              <TableState
                loading={list.loading}
                error={list.error}
                empty={d?.rows.length === 0}
                colSpan={8}
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
          <OrderDetail
            id={selected}
            onClose={() => setSelected(null)}
            // Hand off to the customer view rather than nesting a second panel.
            onOpenCustomer={(customerId) => {
              window.location.hash = `customers?open=${customerId}`;
            }}
          />
        )}
      </div>
    </>
  );
}
