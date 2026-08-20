import { useState } from 'react';
import type { UssdStep } from '../../api';

/**
 * The menu, edited as a sequence rather than as JSON.
 *
 * These get written from screenshots of a real handset and edited during an
 * incident — the operator changed their menu, every dispatch is failing, and
 * someone is fixing it quickly. A textarea of JSON is the wrong instrument for
 * that: a missing brace publishes nothing, a stray backslash publishes a regex
 * that silently matches no dialog, and neither failure is visible until a
 * device is already typing into a live prompt.
 *
 * So each step is two fields, the order is explicit, every pattern is compiled
 * as it is typed, and the substitution tokens are buttons rather than
 * something to spell correctly.
 */

const TOKENS = ['{msisdn}', '{amount}', '{pin}'] as const;

/** Compiles, or says why not. The device would fail the same way, silently. */
function regexError(pattern: string): string | null {
  if (!pattern.trim()) return 'empty';
  try {
    new RegExp(pattern, 'i');
    return null;
  } catch (e) {
    return (e as Error).message.replace(/^Invalid regular expression:?\s*/i, '').slice(0, 60);
  }
}

export function stepsAreValid(steps: UssdStep[]): boolean {
  return steps.length > 0 && steps.every((s) => regexError(s.expect) === null && s.send.trim().length > 0);
}

export default function StepEditor({
  steps,
  onChange,
}: {
  steps: UssdStep[];
  onChange: (next: UssdStep[]) => void;
}) {
  /**
   * A line of dialog to try the patterns against.
   *
   * The single most useful thing here. The script is built by reading
   * screenshots, so being able to paste what each screen actually said and see
   * which step claims it is the difference between publishing a menu that
   * works and finding out on the bench.
   */
  const [probe, setProbe] = useState('');

  const patch = (i: number, next: Partial<UssdStep>) =>
    onChange(steps.map((s, n) => (n === i ? { ...s, ...next } : s)));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const insertToken = (i: number, token: string) =>
    patch(i, { send: (steps[i].send + token).trim() });

  /** Which step a probed dialog would be answered by, walking in order. */
  const probeHit = (() => {
    if (!probe.trim()) return -1;
    return steps.findIndex((s) => {
      const err = regexError(s.expect);
      if (err) return false;
      return new RegExp(s.expect, 'i').test(probe);
    });
  })();

  return (
    <div>
      {steps.map((step, i) => {
        const err = regexError(step.expect);
        const hit = probeHit === i;
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 1fr auto',
              gap: 8,
              alignItems: 'start',
              padding: '8px 0',
              borderTop: '1px solid var(--color-rule)',
              background: hit ? 'var(--color-accent-100)' : undefined,
            }}
          >
            <span className="figure num" style={{ paddingTop: 10, opacity: 0.6 }}>
              {i + 1}
            </span>

            <div>
              <input
                className="input num"
                // Two pixels, not a colour change: `.input:focus-visible`
                // already turns the border accent-red, so tinting an invalid
                // field the same red makes a focused field indistinguishable
                // from a broken one. Weight separates them.
                style={{
                  width: '100%',
                  ...(err ? { borderWidth: 2, borderColor: 'var(--color-accent-800)' } : null),
                }}
                placeholder="dialog contains… (regex)"
                aria-label={`Step ${i + 1} pattern`}
                value={step.expect}
                onChange={(e) => patch(i, { expect: e.target.value })}
              />
              {err && (
                <p className="note" style={{ color: 'var(--color-accent-800)' }}>
                  {err === 'empty' ? 'Needed — a step with no pattern matches nothing.' : err}
                </p>
              )}
            </div>

            <div>
              <input
                className="input num"
                style={{ width: '100%' }}
                placeholder="type this"
                aria-label={`Step ${i + 1} reply`}
                value={step.send}
                onChange={(e) => patch(i, { send: e.target.value })}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {TOKENS.map((t) => (
                  <button
                    key={t}
                    className="tag tag-neutral"
                    type="button"
                    style={{ cursor: 'pointer' }}
                    onClick={() => insertToken(i, t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 2 }}>
              {/* Order is not cosmetic — the runner walks strictly in sequence
                  and refuses anything out of turn. */}
              <button className="btn btn-ghost" type="button" aria-label="Move up"
                      disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="btn btn-ghost" type="button" aria-label="Move down"
                      disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="btn btn-ghost" type="button" aria-label="Remove step"
                      onClick={() => onChange(steps.filter((_, n) => n !== i))}>×</button>
            </div>
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-ghost" type="button" onClick={() => onChange([...steps, { expect: '', send: '' }])}>
          + ADD STEP
        </button>
        <span className="count">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
      </div>

      <label className="note" style={{ display: 'block', marginTop: 16 }}>
        Try it — paste what a screen actually says and see which step answers it.
      </label>
      <input
        className="input"
        style={{ width: '100%' }}
        placeholder="Orange Money   1. Transfert   2. Solde"
        value={probe}
        onChange={(e) => setProbe(e.target.value)}
      />
      {probe.trim() && (
        <p className="note" style={{ color: probeHit < 0 ? 'var(--color-accent-800)' : undefined }}>
          {probeHit < 0
            ? 'No step matches — a device seeing this would abandon the session.'
            : `Step ${probeHit + 1} answers it with “${steps[probeHit].send}”.`}
        </p>
      )}
    </div>
  );
}
