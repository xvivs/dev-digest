/** Turn tool arguments (owner/name, PR number, agent id or name) into API ids. */
import type { DevDigestApi } from './api/client.js';
import type { AgentLite, RepoLite } from './api/schemas.js';
import { toolErrors } from './errors.js';

export async function resolveRepo(api: DevDigestApi, repo: string): Promise<RepoLite> {
  const wanted = repo.toLowerCase();
  const matches = (await api.listRepos()).filter((r) => r.full_name.toLowerCase() === wanted);
  if (matches.length === 0) throw toolErrors.repoNotFound(repo);
  if (matches.length > 1) throw toolErrors.ambiguousRepo(repo, matches.map((r) => r.id));
  return matches[0]!;
}

/**
 * Note: `GET /repos/:id/pulls` syncs from GitHub before it answers, so this is
 * not a pure read (see the spec, "PR resolution is not a pure read").
 */
export async function resolvePr(
  api: DevDigestApi,
  repo: RepoLite,
  prNumber: number,
): Promise<{ id: string; number: number }> {
  const pulls = await api.listPulls(repo.id);
  const pr = pulls.find((p) => p.number === prNumber && typeof p.id === 'string' && p.id !== '');
  if (!pr || !pr.id) throw toolErrors.prNotFound(repo.full_name, prNumber);
  return { id: pr.id, number: pr.number };
}

/** An exact id wins over a name; names match case-insensitively and exactly. */
export async function resolveAgent(api: DevDigestApi, agent: string): Promise<AgentLite> {
  const agents = await api.listAgents();
  const byId = agents.find((a) => a.id === agent);
  const picked = byId ?? pickByName(agents, agent);
  if (!picked.enabled) throw toolErrors.agentDisabled(picked.name);
  return picked;
}

function pickByName(agents: readonly AgentLite[], agent: string): AgentLite {
  const wanted = agent.toLowerCase();
  const matches = agents.filter((a) => a.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw toolErrors.ambiguousAgent(agent, matches.map((a) => ({ id: a.id, name: a.name })));
  }
  const names = agents.map((a) => a.name).sort((x, y) => x.localeCompare(y));
  throw toolErrors.agentNotFound(agent, names);
}
