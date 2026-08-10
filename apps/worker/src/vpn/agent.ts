import type { Env } from '../env';

export type Server = {
  id: string;
  name: string;
  api_url: string;
  active: number;
};

export type CreatedPeer = { publicKey: string; address: string; conf: string };

const TIMEOUT_MS = 8000;

/** Domain separator, so the signing key can never be reused to mint some other credential. */
const PURPOSE = 'wg-agent:v1:';

/**
 * The bearer token for one VPS agent.
 *
 * Derived rather than stored. Each box gets a distinct token — so a compromised
 * one cannot drive peer management on the others — without any of them sitting
 * in D1, where a dump or a stray support query would expose the whole fleet.
 * The operator reads the value once from the console and feeds it to the
 * installer; rotation is a change of AGENT_SIGNING_KEY plus a re-install.
 */
export async function deriveAgentToken(env: Env, serverId: string): Promise<string> {
  if (!env.AGENT_SIGNING_KEY) throw new AgentError('AGENT_SIGNING_KEY is not configured');
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    bytes.encode(env.AGENT_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, bytes.encode(PURPOSE + serverId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calls a VPS agent.
 *
 * Every call is bounded: a hung agent previously pinned the Worker until
 * platform limits.
 */
export async function agent<T>(
  env: Env,
  server: Pick<Server, 'id' | 'api_url'>,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const base = server.api_url.replace(/\/+$/, '');
  const token = await deriveAgentToken(env, server.id);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new AgentError(`agent ${method} ${path} unreachable: ${(e as Error).message}`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & T;
  if (!res.ok) throw new AgentError(`agent ${method} ${path} → ${res.status} ${data.error ?? ''}`);
  return data;
}

export class AgentError extends Error {}

export const loadServer = (env: Env, id: string) =>
  env.DB
    .prepare(`SELECT id, name, api_url, active FROM servers WHERE id = ? AND active = 1`)
    .bind(id)
    .first<Server>();
