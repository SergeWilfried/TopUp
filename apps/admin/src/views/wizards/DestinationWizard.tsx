import { useState } from 'react';
import { ApiError, apiSend, type Destination, type Page } from '../../api';
import { useApi } from '../../useApi';
import { Choice, Field, Review, Wizard } from '../../components/Wizard';

type Kind = 'home' | 'travel' | 'region';

const KINDS: { value: Kind; title: string; sub: string }[] = [
  { value: 'travel', title: 'Travel', sub: 'A single country for visitors' },
  { value: 'region', title: 'Regional', sub: 'One plan spanning several countries' },
  { value: 'home', title: 'Home', sub: 'The local market, sold on local networks' },
];

export default function DestinationWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [coverage, setCoverage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Codes are checked here for instant feedback; the worker enforces it too.
  const existingCodes = (useApi<Page<Destination>>('/admin/destinations', {}).data?.rows ?? []).map((d) => d.code);

  const codeTaken = existingCodes.includes(code.toUpperCase());
  const codeOk = /^[A-Z]{2}$/.test(code.toUpperCase()) && !codeTaken;

  return (
    <Wizard
      kicker="New destination"
      title="Add an eSIM destination"
      submitLabel={saving ? 'CREATING…' : 'CREATE DESTINATION'}
      onCancel={onCancel}
      onSubmit={async () => {
        setSaving(true);
        setError(null);
        try {
          await apiSend('POST', '/admin/destinations', {
            name: name.trim(),
            code: code.toUpperCase(),
            sub: coverage.trim(),
            type: kind,
          });
          onCreated();
        } catch (e) {
          setError(e instanceof ApiError ? `${e.code}${e.field ? ` (${e.field})` : ''}` : 'network error');
          setSaving(false);
        }
      }}
      steps={[
        {
          label: 'Kind',
          valid: kind !== null,
          content: (
            <>
              <p className="note">How travellers will see this market in the app.</p>
              <Choice options={KINDS} value={kind} onChange={setKind} />
            </>
          ),
        },
        {
          label: 'Identity',
          valid: name.trim().length > 1 && codeOk,
          content: (
            <>
              <Field label="Destination name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morocco" />
              </Field>
              <Field
                label="Code"
                hint={
                  codeTaken
                    ? 'That code is already in use.'
                    : 'Two letters — the badge shown in the destination list.'
                }
              >
                <input
                  className="input"
                  value={code}
                  maxLength={2}
                  onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
                  placeholder="MA"
                />
              </Field>
            </>
          ),
        },
        {
          label: 'Coverage',
          valid: coverage.trim().length > 0,
          content: (
            <Field label="Coverage line" hint="Shown under the name — e.g. “Travel” or “Regional · 8 countries”.">
              <input
                className="input"
                value={coverage}
                onChange={(e) => setCoverage(e.target.value)}
                placeholder="Travel"
              />
            </Field>
          ),
        },
        {
          label: 'Review',
          content: (
            <>
              <p className="note">Plans can be attached to this destination once it exists.</p>
              {error && <p className="note" style={{ color: 'var(--color-accent)' }}>Could not save: {error}</p>}
              <Review
                rows={[
                  ['Destination', name || '—'],
                  ['Code', code.toUpperCase() || '—'],
                  ['Coverage', coverage || '—'],
                  ['Type', kind?.toUpperCase() ?? '—'],
                ]}
              />
            </>
          ),
        },
      ]}
    />
  );
}
