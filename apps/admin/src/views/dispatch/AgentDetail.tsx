import { fmt } from '@topup/core';
import type { AgentDetail as Detail } from '../../api';
import { useApi } from '../../useApi';
import { Modal } from '../../components/Modal';
import { Loaded } from '../../states';

/**
 * One SIM, and what it has actually been doing.
 *
 * The fleet table answers "is something wrong". This answers "wrong how" — a
 * SIM that stopped dispatching looks identical from outside whether it ran out
 * of float, hit its daily cap, has no menu to type, or has been failing every
 * job for an hour. Only the last of those needs someone tonight.
 */

const time = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const TONE: Record<string, string> = {
  sent: 'tag-neutral',
  queued: 'tag-outline',
  leased: 'tag-outline',
  failed: 'tag-accent',
  unknown: 'tag-accent',
};

export default function AgentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error, reload } = useApi<Detail>(`/admin/agents/${encodeURIComponent(id)}`);
  const a = data?.agent;

  return (
    <Modal
      kicker="SIM"
      title={a ? a.label || a.msisdn : 'SIM'}
      wide
      onClose={onClose}
    >
      <Loaded loading={loading} error={error} onRetry={reload}>
        {a && (
          <>
            <div className="rows">
              <div className="row">
                <span className="k">Number</span>
                <span className="figure num">{a.msisdn}</span>
              </div>
              <div className="row">
                <span className="k">Route</span>
                <span className="figure">
                  {a.country} · {a.carrier}
                </span>
              </div>
              <div className="row">
                <span className="k">USSD menu</span>
                {/* No script means this SIM polls for ever and dispatches
                    nothing — the loop declines work it cannot do. */}
                {a.scriptVersion === null ? (
                  <span className="tag tag-accent">NONE PUBLISHED</span>
                ) : (
                  <span className="figure num">v{a.scriptVersion}</span>
                )}
              </div>
              <div className="row">
                <span className="k">Float</span>
                <span className="figure num">{a.floatBalance === null ? 'not reported' : fmt(a.floatBalance)}</span>
              </div>
              <div className="row">
                <span className="k">Today</span>
                <span className="figure num">
                  {a.dailyCount}
                  {a.dailyCap === null ? '' : ` / ${a.dailyCap}`}
                </span>
              </div>
              <div className="row">
                <span className="k">Last seen</span>
                <span className="figure num">{a.lastSeen ? time(a.lastSeen) : 'never'}</span>
              </div>
              <div className="row">
                <span className="k">Lifetime</span>
                <span className="figure num">
                  {data.tally.sent ?? 0} sent · {data.tally.failed ?? 0} failed · {data.tally.unknown ?? 0} unknown
                </span>
              </div>
            </div>

            <h4 style={{ marginTop: 20 }}>Recent jobs</h4>
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>TO</th>
                    <th className="right">AMOUNT</th>
                    <th className="right">WHEN</th>
                    <th className="right">RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="num">{j.msisdn}</td>
                      <td className="right figure num">{fmt(j.amount)}</td>
                      <td className="right muted num">{time(j.createdAt)}</td>
                      <td className="right">
                        <span className={`tag ${TONE[j.status] ?? 'tag-outline'}`}>{j.status.toUpperCase()}</span>
                        {j.failureReason && <div className="note">{j.failureReason}</div>}
                      </td>
                    </tr>
                  ))}
                  {data.jobs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="empty">
                        Nothing dispatched yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Loaded>
    </Modal>
  );
}
