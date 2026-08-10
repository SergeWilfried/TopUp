import { useEffect, useState } from 'react';
import { fmtDate, fmtN } from '@topup/core';
import { ApiError, apiSend, type Subscription, type SubscriptionPage } from '../api';
import { useApi } from '../useApi';
import { KpiStrip, Meter, PageHead, Pager, Panel, SecHead, Seg, SubTag } from '../components/Bits';
import { TableState } from '../states';

const DAY = 86400000;
const FILTERS = ['all', 'active', 'expiring', 'lapsed'] as const;

export default function Vpn() {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => setPage(1), [status]);

  const list = useApi<SubscriptionPage>('/admin/subscriptions', { status, page, perPage: 8 });
  const d = list.data;
  const peak = Math.max(...(d?.installsByLocation ?? []).map((l) => l.installs), 1);

  const act = async (action: 'regenerate' | 'extend') => {
    if (!selected) return;
    if (
      action === 'regenerate' &&
      // The conf holds a private key the agent mints once and we never store,
      // so there is nothing to "resend" — only new keys, which break whatever
      // the customer has installed today.
      !window.confirm(
        `Re-issue every tunnel for ${selected.email}?\n\nTheir current configs stop working immediately and they must install the new ones.`,
      )
    ) {
      return;
    }
    setBusy(action);
    setFlash(null);
    try {
      if (action === 'regenerate') {
        const r = await apiSend<{ reissued: number; to: string; failed: string[] }>(
          'POST',
          `/admin/subscriptions/${selected.id}/regenerate`,
          {},
        );
        setFlash(
          `Re-issued ${r.reissued} tunnel${r.reissued === 1 ? '' : 's'} for ${r.to}` +
            (r.failed.length ? ` · ${r.failed.length} failed` : ''),
        );
        list.reload();
      } else {
        const updated = await apiSend<Subscription>('POST', `/admin/subscriptions/${selected.id}/extend`, {
          days: 30,
        });
        setSelected(updated);
        setFlash(`Extended to ${fmtDate(updated.expiresAt)}`);
        list.reload();
      }
    } catch (e) {
      setFlash(e instanceof ApiError ? `Failed: ${e.code}` : 'Failed: network error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHead
        kicker="Premium"
        title={`${fmtN(d?.total ?? 0)} subscriptions`}
        right={<span className="count">One tunnel per location — a subscriber counts once per install</span>}
      />

      <KpiStrip
        items={[
          { label: 'Active', value: fmtN(d?.counts.active ?? 0), sub: 'beyond 7 days' },
          { label: 'Expiring', value: fmtN(d?.counts.expiring ?? 0), sub: 'within 7 days — chase these' },
          { label: 'Lapsed', value: fmtN(d?.counts.lapsed ?? 0), sub: 'renewal opportunity' },
          {
            label: 'Tunnels issued',
            value: fmtN(d?.counts.tunnels ?? 0),
            sub: `across ${d?.installsByLocation.length ?? 0} locations`,
          },
        ]}
      />

      <div className="split">
        <div>
          <SecHead title="Subscriptions" right={<Seg options={FILTERS} value={status} onChange={setStatus} />} />
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>REF</th>
                  <th>ACCOUNT</th>
                  <th>PLAN</th>
                  <th className="right">LOCATIONS</th>
                  <th>RENEWS</th>
                  <th className="right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {d?.rows.map((s) => {
                  const days = Math.round((s.expiresAt - Date.now()) / DAY);
                  const total = d.installsByLocation.length || 1;
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => { setSelected(s); setFlash(null); }}>
                      <td className="lead num">{s.id}</td>
                      <td className="muted">{s.email}</td>
                      <td>{s.plan}</td>
                      <td className="right">
                        <Meter pct={(s.locations.length / total) * 100} label={`${s.locations.length}/${total}`} />
                      </td>
                      <td className="num">
                        <div>{fmtDate(s.expiresAt)}</div>
                        <div className="muted">{days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`}</div>
                      </td>
                      <td className="right">
                        <SubTag status={s.status} />
                      </td>
                    </tr>
                  );
                })}
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

        <div className="stack">
          {selected ? (
            <Panel>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div className="kicker">Subscription</div>
                  <h3 className="title">{selected.plan}</h3>
                  <p className="note" style={{ marginTop: 4 }}>
                    {selected.id} · {selected.email}
                  </p>
                </div>
                <button className="btn btn-ghost" type="button" onClick={() => setSelected(null)} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="rows" style={{ marginTop: 16 }}>
                <div className="row">
                  <span className="k">Started</span>
                  <span className="num">{selected.startedAt ? fmtDate(selected.startedAt) : '—'}</span>
                </div>
                <div className="row">
                  <span className="k">Renews</span>
                  <span className="num">{fmtDate(selected.expiresAt)}</span>
                </div>
                <div className="row">
                  <span className="k">Devices</span>
                  <span className="num">{selected.devices}</span>
                </div>
                <div className="row">
                  <span className="k">Installed</span>
                  <span className="num">{selected.locations.join(' · ')}</span>
                </div>
                <div className="row">
                  <span className="k">Status</span>
                  <SubTag status={selected.status} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={busy !== null}
                  onClick={() => act('regenerate')}
                >
                  {busy === 'regenerate' ? 'RE-ISSUING…' : 'RE-ISSUE CONFIGS'}
                </button>
                <button className="btn btn-secondary" type="button" disabled={busy !== null} onClick={() => act('extend')}>
                  {busy === 'extend' ? 'EXTENDING…' : 'EXTEND 30 DAYS'}
                </button>
              </div>
              {flash && (
                <p className="note" style={{ marginTop: 12 }}>
                  {flash}
                </p>
              )}
            </Panel>
          ) : (
            <Panel>
              <p className="note">Select a subscription to inspect its tunnels or resend the install QR codes.</p>
            </Panel>
          )}

          <Panel title="Installs by location">
            <div className="dist" style={{ marginTop: 14 }}>
              {(d?.installsByLocation ?? []).map((l) => (
                <div className="dist-row" key={l.code}>
                  <span className="lead">{l.name}</span>
                  <span className="track">
                    <i style={{ width: `${(l.installs / peak) * 100}%` }} />
                  </span>
                  <span className="val num">{l.installs}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
