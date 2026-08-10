import { useTranslation } from 'react-i18next';
import { airtimePacks, dataPacks, vpnPlans, VPN_LOCATIONS, fmt } from '@topup/core';
import { setLanguage } from './i18n';

type Pack = { n: string; v: string; p: number; b?: string | null };

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
];

function PackGrid({ items }: { items: Pack[] }) {
  return (
    <div className="grid">
      {items.map((p) => (
        <button key={p.n} className="card" type="button">
          <div className="tag-slot">{p.b ? <span className="tag">{p.b}</span> : null}</div>
          <div>
            <div className="name">{p.n}</div>
            <div className="sub">{p.v}</div>
          </div>
          <div className="foot">
            {/* Airtime packs are named by their price — don't print it twice. */}
            <span className="price">{p.n === fmt(p.p) ? '' : fmt(p.p)}</span>
            <span className="arrow">→</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { t, i18n } = useTranslation();

  return (
    <>
      <div className="wrap">
        <header className="bar">
          <div className="brand">
            TOPUP<span>.</span>
          </div>
          <div className="langs">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                aria-pressed={i18n.language === l.code}
                onClick={() => setLanguage(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </header>
      </div>

      <div className="wrap">
        <div className="hero">
          <div className="kicker">{t('vpn.premium')}</div>
          <h1>{t('welcome.poster')}</h1>
          <p>{t('welcome.trust')}</p>
        </div>

        <section>
          <div className="kicker">{t('home.quickBuy')}</div>
          <h2>{t('packs.airtimeTitle')}</h2>
          <PackGrid items={airtimePacks(t)} />
        </section>

        <section>
          <h2>{t('packs.dataTitle')}</h2>
          <PackGrid items={dataPacks(t)} />
        </section>

        <section>
          <div className="kicker">{t('vpn.premium')}</div>
          <h2>{t('vpn.heroTitle')}</h2>
          <PackGrid items={vpnPlans(t)} />
          <div className="locations">
            <div className="kicker">{t('vpn.locationsIncluded', { count: VPN_LOCATIONS.length })}</div>
            <strong>{VPN_LOCATIONS.map((l) => l.name).join(' · ')}</strong>
            <p>{t('vpn.locationsBody')}</p>
          </div>
        </section>

        <footer>{t('onboarding.trust')}</footer>
      </div>
    </>
  );
}
