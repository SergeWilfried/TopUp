import { useState } from 'react';
import { CARRIERS, fmt } from '@topup/core';
import { ApiError, apiSend, type Destination, type Page, type ProductType } from '../../api';
import { useApi } from '../../useApi';
import { Choice, Field, Review, Wizard } from '../../components/Wizard';

const HOME = 'Côte d’Ivoire';

type Type = ProductType;

const TYPE_OPTIONS: { value: Type; title: string; sub: string }[] = [
  { value: 'airtime', title: 'Airtime', sub: 'Credit on a local network' },
  { value: 'data', title: 'Data pack', sub: 'A bundle with a validity window' },
  { value: 'esim', title: 'eSIM plan', sub: 'Sold against a destination' },
  { value: 'vpn', title: 'VPN plan', sub: 'Subscription, no network' },
];

export default function ProductWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<Type | null>(null);
  const [country, setCountry] = useState(HOME);
  const [network, setNetwork] = useState(CARRIERS[0].name);
  const [name, setName] = useState('');
  const [terms, setTerms] = useState('');
  const [bonus, setBonus] = useState('');
  const [price, setPrice] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const countries = useApi<Page<Destination>>('/admin/destinations', {}).data?.rows ?? [];
  const needsNetwork = type === 'airtime' || type === 'data';
  const isEsim = type === 'esim';
  const isVpn = type === 'vpn';
  const priceNum = Number(price.replace(/\D/g, ''));

  const resolvedCountry = isVpn ? 'Global' : isEsim ? country : HOME;
  const resolvedNetwork = isVpn ? null : isEsim ? 'Travel' : network;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiSend('POST', '/admin/products', {
        name: name.trim(),
        type,
        country: resolvedCountry,
        network: resolvedNetwork,
        terms: terms.trim(),
        bonus: bonus.trim() || null,
        price: priceNum,
      });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}${e.field ? ` (${e.field})` : ''}` : 'network error');
      setSaving(false);
    }
  };

  return (
    <Wizard
      kicker="New product"
      title="Add a product"
      submitLabel={saving ? 'CREATING…' : 'CREATE PRODUCT'}
      onCancel={onCancel}
      onSubmit={submit}
      steps={[
        {
          label: 'Type',
          valid: type !== null,
          content: (
            <>
              <p className="note">What are you selling? This decides which fields matter.</p>
              <Choice options={TYPE_OPTIONS} value={type} onChange={setType} />
            </>
          ),
        },
        {
          label: 'Market',
          valid: true,
          content: (
            <>
              {isVpn && (
                <p className="note">
                  VPN is sold globally and is not tied to a network, so there is nothing to pick here.
                </p>
              )}
              {isEsim && (
                <Field label="Destination" hint="eSIM plans are priced per destination.">
                  <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {countries.map((c) => (
                      <option key={c.code} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {needsNetwork && (
                <>
                  <Field label="Country">
                    <input className="input" value={HOME} readOnly />
                  </Field>
                  <Field label="Network" hint="The same pack is a separate SKU on each network.">
                    <select className="input" value={network} onChange={(e) => setNetwork(e.target.value)}>
                      {CARRIERS.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}
            </>
          ),
        },
        {
          label: 'Pricing',
          valid: name.trim().length > 0 && terms.trim().length > 0 && priceNum > 0,
          content: (
            <>
              <Field label="Product name" hint="What the customer sees — e.g. “5 GB” or “2 000 FCFA”.">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="5 GB" />
              </Field>
              <div className="grid2">
                <Field label="Validity / terms">
                  <input
                    className="input"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="Valid 30 days"
                  />
                </Field>
                <Field label="Price (FCFA)">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
                    placeholder="2500"
                  />
                </Field>
              </div>
              <Field label="Bonus badge" hint="Optional — leave blank for none.">
                <input
                  className="input"
                  value={bonus}
                  onChange={(e) => setBonus(e.target.value)}
                  placeholder="+10% BONUS"
                />
              </Field>
            </>
          ),
        },
        {
          label: 'Review',
          content: (
            <>
              <p className="note">This goes live in both apps immediately.</p>
              {error && <p className="note" style={{ color: 'var(--color-accent)' }}>Could not save: {error}</p>}
              <Review
                rows={[
                  ['Product', name || '—'],
                  ['Type', type?.toUpperCase() ?? '—'],
                  ['Country', resolvedCountry],
                  ['Network', resolvedNetwork ?? '—'],
                  ['Terms', terms || '—'],
                  ['Bonus', bonus || '—'],
                  ['Price', priceNum ? fmt(priceNum) : '—'],
                ]}
              />
            </>
          ),
        },
      ]}
    />
  );
}
