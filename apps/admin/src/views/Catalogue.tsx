import { useEffect, useState } from 'react';
import { fmt, fmtN, CARRIERS } from '@topup/core';
import { ApiError, apiSend, type Destination, type Endpoint, type Page, type Product } from '../api';
import { useApi } from '../useApi';
import { KpiStrip, PageHead, Pager, SecHead, Seg } from '../components/Bits';
import { TableState } from '../states';
import ProductWizard from './wizards/ProductWizard';
import DestinationWizard from './wizards/DestinationWizard';
import EndpointWizard from './wizards/EndpointWizard';

const TYPES = ['all', 'airtime', 'data', 'esim', 'vpn'] as const;
const NETWORKS = ['all', ...CARRIERS.map((c: { name: string }) => c.name), 'Travel'] as const;
const SECTIONS = ['products', 'destinations', 'endpoints'] as const;
type Section = (typeof SECTIONS)[number];

export default function Catalogue() {
  // One dataset at a time — products, destinations and endpoints answer
  // different questions and stacking them made the page hard to scan.
  const [section, setSection] = useState<Section>('products');
  const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [wizard, setWizard] = useState<Section | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setPage(1), [type, network, query, section]);

  const products = useApi<Page<Product>>('/admin/products', { type, network, q: query, page, perPage: 12 });
  const destinations = useApi<Page<Destination>>('/admin/destinations', {});
  const endpoints = useApi<Page<Endpoint>>('/admin/endpoints', {});

  const disabled = (products.data?.rows ?? []).filter((p) => !p.enabled).length;

  const toggle = async (p: Product) => {
    setBusy(p.id);
    try {
      await apiSend('PATCH', `/admin/products/${encodeURIComponent(p.id)}`, { enabled: !p.enabled });
      products.reload();
    } finally {
      setBusy(null);
    }
  };

  const title =
    section === 'products'
      ? `${fmtN(products.data?.total ?? 0)} products`
      : section === 'destinations'
        ? `${fmtN(destinations.data?.total ?? 0)} destinations`
        : `${fmtN(endpoints.data?.total ?? 0)} endpoints`;

  return (
    <>
      <PageHead
        kicker="Merchandising"
        title={title}
        right={
          section === 'products' ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search product or country…"
                aria-label="Search catalogue"
              />
              <button className="btn btn-primary" type="button" onClick={() => setWizard('products')}>
                + NEW PRODUCT
              </button>
            </div>
          ) : (
            <button className="btn btn-secondary" type="button" onClick={() => setWizard(section)}>
              {section === 'destinations' ? '+ NEW DESTINATION' : '+ NEW ENDPOINT'}
            </button>
          )
        }
      />

      <KpiStrip
        items={[
          { label: 'Products', value: fmtN(products.data?.total ?? 0), sub: `${disabled} disabled on this page` },
          { label: 'Markets', value: fmtN(destinations.data?.total ?? 0), sub: 'countries and regions' },
          { label: 'Networks', value: String(CARRIERS.length), sub: CARRIERS.map((c: { name: string }) => c.name).join(' · ') },
          { label: 'VPN locations', value: fmtN(endpoints.data?.total ?? 0), sub: 'WireGuard endpoints' },
        ]}
      />

      <Seg options={SECTIONS} value={section} onChange={setSection} />

      {section === 'products' && (
        <div>
          <SecHead
            title="Products"
            right={
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Seg options={NETWORKS} value={network} onChange={setNetwork} />
                <Seg options={TYPES} value={type} onChange={setType} />
              </div>
            }
          />
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>PRODUCT</th>
                  <th>TYPE</th>
                  <th>COUNTRY</th>
                  <th>NETWORK</th>
                  <th>VALIDITY</th>
                  <th>BONUS</th>
                  <th className="right">PRICE</th>
                  <th className="right">SOLD (30 D)</th>
                  <th className="right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {products.data?.rows.map((l) => (
                  <tr key={l.id}>
                    <td className="lead">{l.name}</td>
                    <td>
                      <span className="tag tag-neutral">{l.type.toUpperCase()}</span>
                    </td>
                    <td>{l.country}</td>
                    <td className="muted">{l.network ?? '—'}</td>
                    <td className="muted wrap">{l.terms}</td>
                    <td>{l.bonus ? <span className="tag tag-accent">{l.bonus}</span> : <span className="muted">—</span>}</td>
                    <td className="right figure num">{fmt(l.price)}</td>
                    <td className="right num muted">{l.sold}</td>
                    <td className="right">
                      <span
                        className={`tag ${l.enabled ? 'tag-outline' : 'tag-accent'}`}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: busy === l.id ? 'wait' : 'pointer' }}
                        onClick={() => toggle(l)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(l)}
                      >
                        {busy === l.id ? '…' : l.enabled ? 'LIVE' : 'DISABLED'}
                      </span>
                    </td>
                  </tr>
                ))}
                <TableState
                  loading={products.loading}
                  error={products.error}
                  empty={products.data?.rows.length === 0}
                  colSpan={9}
                  onRetry={products.reload}
                />
              </tbody>
            </table>
          </div>
          {products.data && (
            <Pager
              page={products.data.page}
              pages={products.data.pages}
              label={`${(products.data.page - 1) * products.data.perPage + (products.data.total ? 1 : 0)}–${Math.min(products.data.page * products.data.perPage, products.data.total)} of ${products.data.total}`}
              onPage={setPage}
            />
          )}
        </div>
      )}

      {section === 'destinations' && (
        <div>
          <SecHead title="eSIM destinations" right={<span className="count">Where travellers can buy data</span>} />
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>DESTINATION</th>
                  <th>CODE</th>
                  <th>COVERAGE</th>
                  <th className="right">PLANS</th>
                  <th className="right">SOLD (30 D)</th>
                  <th className="right">TYPE</th>
                </tr>
              </thead>
              <tbody>
                {destinations.data?.rows.map((c) => (
                  <tr key={c.code}>
                    <td className="lead">{c.name}</td>
                    <td className="muted num">{c.code}</td>
                    <td className="muted wrap">{c.sub}</td>
                    <td className="right num">{c.plans}</td>
                    <td className="right num muted">{c.sold}</td>
                    <td className="right">
                      <span className="tag tag-neutral">{c.type.toUpperCase()}</span>
                    </td>
                  </tr>
                ))}
                <TableState
                  loading={destinations.loading}
                  error={destinations.error}
                  empty={destinations.data?.rows.length === 0}
                  colSpan={6}
                  onRetry={destinations.reload}
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'endpoints' && (
        <div>
          <SecHead title="VPN endpoints" right={<span className="count">One WireGuard tunnel per endpoint</span>} />
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>LOCATION</th>
                  <th>CODE</th>
                  <th>HOST</th>
                  <th className="right">INSTALLS</th>
                  <th className="right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.data?.rows.map((l) => (
                  <tr key={l.code}>
                    <td className="lead">{l.name}</td>
                    <td className="muted num">{l.code}</td>
                    <td className="muted num">{l.host}</td>
                    <td className="right num">{l.installs}</td>
                    <td className="right">
                      <span className="tag tag-outline">LIVE</span>
                    </td>
                  </tr>
                ))}
                <TableState
                  loading={endpoints.loading}
                  error={endpoints.error}
                  empty={endpoints.data?.rows.length === 0}
                  colSpan={5}
                  onRetry={endpoints.reload}
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {wizard === 'products' && (
        <ProductWizard
          onCancel={() => setWizard(null)}
          onCreated={() => {
            setWizard(null);
            setSection('products');
            products.reload();
          }}
        />
      )}

      {wizard === 'destinations' && (
        <DestinationWizard onCancel={() => setWizard(null)} onCreated={() => { setWizard(null); destinations.reload(); }} />
      )}

      {wizard === 'endpoints' && (
        <EndpointWizard onCancel={() => setWizard(null)} onCreated={() => { setWizard(null); endpoints.reload(); }} />
      )}
    </>
  );
}

/** Shared by the wizards: turns a worker error into something a user can act on. */
export const errorText = (e: unknown) =>
  e instanceof ApiError ? `${e.code}${e.field ? ` (${e.field})` : ''}` : 'network error';
