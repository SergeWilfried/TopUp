import { useState } from 'react';
import { PAYABLE_COUNTRIES } from '@topup/core';
import { ApiError, apiSend, type Flags as FlagsData } from '../../api';
import { useApi } from '../../useApi';
import { SecHead } from '../../components/Bits';
import { TableState } from '../../states';

/**
 * Per-market feature switches.
 *
 * A grid rather than a list of overrides, because the question an operator
 * actually has is "what is on in Burkina right now" — and a list of exceptions
 * answers that only by making them reconstruct it from what is absent.
 *
 * `*` is the default column: it applies wherever a country has no cell of its
 * own, so "off everywhere except the pilot market" is two clicks rather than
 * one per country.
 */

const ANY = '*';

type Cell = 'default' | 'on' | 'off';

/** Cycles default → on → off → default, so one control covers all three. */
const nextState = (current: Cell): Cell =>
  current === 'default' ? 'on' : current === 'on' ? 'off' : 'default';

export default function Features() {
  const flags = useApi<FlagsData>('/admin/features', {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const countries: string[] = [ANY, ...PAYABLE_COUNTRIES.map((c: { code: string }) => c.code)];
  const features = flags.data?.features ?? [];

  const overrideOf = (feature: string, country: string) =>
    flags.data?.overrides.find((o) => o.feature === feature && o.country === country);

  const stateOf = (feature: string, country: string): Cell => {
    const row = overrideOf(feature, country);
    return row === undefined ? 'default' : row.enabled ? 'on' : 'off';
  };

  /** What the market actually resolves to — the number that matters. */
  const effective = (feature: string, country: string): boolean => {
    const exact = overrideOf(feature, country);
    if (exact) return exact.enabled;
    const wildcard = overrideOf(feature, ANY);
    if (wildcard) return wildcard.enabled;
    return features.find((f) => f.name === feature)?.default ?? true;
  };

  const flip = async (feature: string, country: string) => {
    const key = `${feature}/${country}`;
    const target = nextState(stateOf(feature, country));
    setBusy(key);
    setError(null);
    try {
      await apiSend<FlagsData>('PUT', `/admin/features/${feature}/${country}`, {
        enabled: target === 'default' ? null : target === 'on',
      });
      flags.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that change');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SecHead
        title="Feature switches"
        right={<span className="count">click a cell: default → on → off</span>}
      />

      <p className="count" style={{ marginBottom: 12 }}>
        Turns a service or payment rail off in one market without a deploy. The worker enforces
        these, so an older app build cannot buy through a disabled feature. <strong>{ANY}</strong>{' '}
        is the default applied wherever a country has no cell of its own.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Feature</th>
              {countries.map((code) => (
                <th key={code} title={code === ANY ? 'Default for every market' : code}>
                  {code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableState
              loading={flags.loading}
              error={flags.error}
              empty={features.length === 0}
              colSpan={countries.length + 1}
              onRetry={flags.reload}
            />
            {features.map((f) => (
              <tr key={f.name}>
                <td style={{ textAlign: 'left' }}>
                  {f.label} <span className="count">default {f.default ? 'on' : 'off'}</span>
                </td>
                {countries.map((code) => {
                  const state = stateOf(f.name, code);
                  const on = effective(f.name, code);
                  const key = `${f.name}/${code}`;
                  return (
                    <td key={code} style={{ textAlign: 'center' }}>
                      <button
                        className="flagcell"
                        disabled={busy === key}
                        onClick={() => flip(f.name, code)}
                        // The glyph is the override, the colour is what the
                        // market resolves to. Both are needed: an inherited
                        // "off" is otherwise indistinguishable from an explicit
                        // one, and only one of those is safe to clear.
                        title={`${f.label} · ${code} · ${state === 'default' ? 'inherited' : 'set explicitly'} · resolves ${on ? 'on' : 'off'}`}
                        style={{
                          color: on ? 'var(--color-ok, #1c6b3c)' : 'var(--color-accent)',
                          fontWeight: state === 'default' ? 400 : 700,
                        }}
                      >
                        {busy === key ? '·' : state === 'default' ? '–' : state === 'on' ? '✓' : '✕'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="count" style={{ color: 'var(--color-accent)', paddingTop: 12 }}>
          {error}
        </p>
      )}

      <p className="count" style={{ paddingTop: 16 }}>
        <strong>–</strong> follows the default · <strong>✓</strong> forced on · <strong>✕</strong>{' '}
        forced off. Green resolves on, red resolves off.
      </p>
    </>
  );
}
