import { useEffect, useState } from 'react';
import SignIn from './views/SignIn';
import { clearToken, readToken, signOut, type Session } from './auth';
import Dashboard from './views/Dashboard';
import Orders from './views/Orders';
import Customers from './views/Customers';
import Vpn from './views/Vpn';
import Catalogue from './views/Catalogue';
import Settings from './views/Settings';

const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', View: Dashboard },
  { id: 'orders', label: 'Transactions', View: Orders },
  { id: 'customers', label: 'Customers', View: Customers },
  { id: 'vpn', label: 'VPN', View: Vpn },
  { id: 'catalogue', label: 'Catalog', View: Catalogue },
  { id: 'settings', label: 'Settings', View: Settings },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];
const isViewId = (v: string): v is ViewId => VIEWS.some((x) => x.id === v);
/** `#orders?open=TX-1` — the view id is everything before the query. */
const viewFromHash = () => window.location.hash.replace('#', '').split('?')[0];

export default function App() {
  // A stored token is assumed valid until a request says otherwise; api.ts
  // clears it on 401, and the poll below drops us back to sign-in.
  const [session, setSession] = useState<Session | null>(() =>
    readToken() ? { token: readToken()!, email: null, isStaff: true } : null,
  );

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (!readToken()) setSession(null);
    }, 2000);
    return () => clearInterval(id);
  }, [session]);

  // Hash routing keeps deep links working without pulling in a router.
  const [view, setView] = useState<ViewId>(() => {
    const initial = viewFromHash();
    return isViewId(initial) ? initial : 'dashboard';
  });

  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash();
      if (isViewId(next)) setView(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id: ViewId) => {
    window.location.hash = id;
    setView(id);
  };

  const Current = VIEWS.find((v) => v.id === view)!.View;

  if (!session) return <SignIn onSignedIn={setSession} />;

  return (
    <div className="app">
      <div className="topnav">
        <div className="left">
          <div className="brand">
            TOPUP<span className="dot">.</span> <span className="sub">Admin</span>
          </div>
          <div className="links">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => go(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="right">
          <span className="tag tag-neutral">LIVE · ABIDJAN</span>
          <button
            className="btn btn-ghost"
            type="button"
            title="Sign out"
            onClick={async () => {
              await signOut();
              clearToken();
              setSession(null);
            }}
          >
            SIGN OUT
          </button>
          <div className="avatar">SA</div>
        </div>
      </div>

      <div className="page">
        <Current />
      </div>
    </div>
  );
}
