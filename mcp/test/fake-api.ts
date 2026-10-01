import type { DevDigestApi } from '../src/api/client.js';
import type {
  AgentLite,
  ConventionsLite,
  PrBlastLite,
  PrLite,
  RepoLite,
  ReviewLite,
  RunLite,
  StartReviewLite,
} from '../src/api/schemas.js';
import { AGENT_ID, PR_ID, REPO_ID, RUN_ID } from './fixtures.js';

/** In-memory DevDigestApi that records every call. Override any method per test. */
export class FakeApi implements DevDigestApi {
  calls: Array<{ method: keyof DevDigestApi; args: unknown[] }> = [];
  repos: RepoLite[] = [{ id: REPO_ID, full_name: 'acme/shop' }];
  pulls: PrLite[] = [{ id: PR_ID, number: 3 }];
  agents: AgentLite[] = [
    { id: AGENT_ID, name: 'Security Reviewer', description: 'Finds security issues', model: 'm', enabled: true },
  ];
  runs: RunLite[] | ((signal?: AbortSignal) => RunLite[] | Promise<RunLite[]>) = [];
  reviews: ReviewLite[] | (() => ReviewLite[] | Promise<ReviewLite[]>) = [];
  conventions: ConventionsLite = { last_scan: null, candidates: [] };
  blast: PrBlastLite = { status: 'ok', reason: null, blast: null, head_sha: 'abc', source_sha: 'def', truncated: false };
  started: StartReviewLite = {
    pr_id: PR_ID,
    runs: [{ run_id: RUN_ID, agent_id: AGENT_ID, agent_name: 'Security Reviewer' }],
  };

  #rec(method: keyof DevDigestApi, args: unknown[]) {
    this.calls.push({ method, args });
  }

  callsTo(method: keyof DevDigestApi) {
    return this.calls.filter((c) => c.method === method);
  }

  async listRepos() {
    this.#rec('listRepos', []);
    return this.repos;
  }
  async listPulls(repoId: string) {
    this.#rec('listPulls', [repoId]);
    return this.pulls;
  }
  async listAgents() {
    this.#rec('listAgents', []);
    return this.agents;
  }
  async startReview(prId: string, agentId: string) {
    this.#rec('startReview', [prId, agentId]);
    return this.started;
  }
  async listRuns(prId: string, signal?: AbortSignal) {
    this.#rec('listRuns', [prId]);
    return typeof this.runs === 'function' ? this.runs(signal) : this.runs;
  }
  async listReviews(prId: string) {
    this.#rec('listReviews', [prId]);
    return typeof this.reviews === 'function' ? this.reviews() : this.reviews;
  }
  async getConventions(repoId: string) {
    this.#rec('getConventions', [repoId]);
    return this.conventions;
  }
  async getBlastRadius(prId: string) {
    this.#rec('getBlastRadius', [prId]);
    return this.blast;
  }
}
