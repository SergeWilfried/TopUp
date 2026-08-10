import { useState } from 'react';
import { ApiError, apiSend, type Endpoint, type Page } from '../../api';
import { useApi } from '../../useApi';
import { Field, Review, Wizard } from '../../components/Wizard';

const HOST_RE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

export default function EndpointWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [host, setHost] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Set once the endpoint exists: the derived token needed to install the agent.
  const [issued, setIssued] = useState<string | null>(null);
  // Codes are checked here for instant feedback; the worker enforces it too.
  const existingCodes = (useApi<Page<Endpoint>>('/admin/endpoints', {}).data?.rows ?? []).map((e) => e.code);

  const codeTaken = existingCodes.includes(code.toUpperCase());
  const codeOk = /^[A-Z]{2}$/.test(code.toUpperCase()) && !codeTaken;
  const hostOk = HOST_RE.test(host.trim().toLowerCase());
  const apiUrlOk = /^https?:\/\/[^\s]+$/.test(apiUrl.trim());

  // The token is derived from the signing key, not stored, so this panel can be
  // reached again later from the endpoint row rather than being a last chance.
  if (issued) {
    return (
      <div className="panel">
        <div className="body">
          <div className="kicker">Endpoint created</div>
          <h2 className="title">Install the agent on {host.trim().toLowerCase()}</h2>
          <p className="note" style={{ margin: '8px 0 16px' }}>
            Run this on the box. The token is unique to {code.toUpperCase()} — no other endpoint
            accepts it, and it is not kept in the database.
          </p>
          <pre className="code-block">
            {`AGENT_TOKEN=${issued} \\\n  API_DOMAIN=${host.trim().toLowerCase()} \\\n  bash install.sh`}
          </pre>
          <button
            className="btn btn-primary"
            type="button"
            style={{ marginTop: 16 }}
            onClick={() => navigator.clipboard?.writeText(issued)}
          >
            COPY TOKEN
          </button>
          <button className="btn btn-ghost" type="button" style={{ marginTop: 8 }} onClick={onCreated}>
            DONE →
          </button>
        </div>
      </div>
    );
  }

  return (
    <Wizard
      kicker="New endpoint"
      title="Add a VPN endpoint"
      submitLabel={saving ? 'CREATING…' : 'CREATE ENDPOINT'}
      onCancel={onCancel}
      onSubmit={async () => {
        setSaving(true);
        setError(null);
        try {
          const created = await apiSend<{ agentToken: string }>('POST', '/admin/endpoints', {
            name: name.trim(),
            code: code.toUpperCase(),
            host: host.trim().toLowerCase(),
            apiUrl: apiUrl.trim(),
          });
          setIssued(created.agentToken);
          setSaving(false);
        } catch (e) {
          setError(e instanceof ApiError ? `${e.code}${e.field ? ` (${e.field})` : ''}` : 'network error');
          setSaving(false);
        }
      }}
      steps={[
        {
          label: 'Location',
          valid: name.trim().length > 1 && codeOk,
          content: (
            <>
              <p className="note">
                Each endpoint becomes its own WireGuard tunnel — subscribers install them one at a time.
              </p>
              <Field label="Location name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos" />
              </Field>
              <Field
                label="Code"
                hint={codeTaken ? 'That code is already in use.' : 'Two letters, shown on the subscription rows.'}
              >
                <input
                  className="input"
                  value={code}
                  maxLength={2}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
                  placeholder="NG"
                />
              </Field>
            </>
          ),
        },
        {
          label: 'Host',
          valid: hostOk && apiUrlOk,
          content: (
            <>
              <Field
                label="Hostname"
                hint={
                  host && !hostOk
                    ? 'Enter a resolvable hostname, e.g. los1.vpn.tofee.app'
                    : 'The peer endpoint written into every config. Port 51820 is assumed.'
                }
              >
                <input
                  className="input"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="los1.vpn.tofee.app"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Agent URL"
                hint={
                  apiUrl && !apiUrlOk
                    ? 'Include the scheme, e.g. https://los1.vpn.tofee.app:8080'
                    : 'Where this box’s management agent listens. Different from the tunnel endpoint above.'
                }
              >
                <input
                  className="input"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://los1.vpn.tofee.app:8080"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </Field>
              <p className="note">
                The agent token is derived from the signing key once this is saved — you will be
                shown the install command next. Existing subscribers do not get this endpoint
                automatically; they install it from the app when they want it.
              </p>
            </>
          ),
        },
        {
          label: 'Review',
          content: (
            <>
              {error && <p className="note" style={{ color: 'var(--color-accent)' }}>Could not save: {error}</p>}
              <Review
              rows={[
                ['Location', name || '—'],
                ['Code', code.toUpperCase() || '—'],
                ['Endpoint', host ? `${host.trim().toLowerCase()}:51820` : '—'],
                ['Agent', apiUrl || '—'],
                ['Token', 'Derived on save'],
                ]}
              />
            </>
          ),
        },
      ]}
    />
  );
}
