/**
 * COMPOSITION — the brief module's composition root. The only brief file that
 * sees the service, the concrete repository and the container together. Adapts
 * the container's shared seams to the service's ports:
 *
 *   PullSource   <- container.reviewRepo (pull, pr_files, pr_commits, repo)
 *   GithubSource <- await container.github()
 *   GitSource    <- container.git
 *   ModelsPort   <- container.featureModel + container.llm
 *   SettingsPort <- BriefRepository.readAutomaticSetting + domain resolveAutomaticBrief (single owner of the ON default)
 *   JobsPort     <- container.briefJobs (concurrency 1, retries 0)
 *   DiffParser   <- container.parseDiff
 *
 * `container.prBrief` is the ONLY caller of `buildBriefService`: the service
 * keeps queued/running state in memory, so routes, jobs and the review executor
 * must share one instance.
 */
import type { Container } from '../../platform/container.js';
import { ConfigError } from '../../platform/errors.js';
import { BRIEF_JOB_KIND } from './constants.js';
import { resolveAutomaticBrief } from './domain.js';
import { BriefRepository } from './repository.js';
import { BriefService } from './service.js';
import type { DerivePayload } from './types.js';

export function buildBriefService(container: Container): BriefService {
  const review = () => container.reviewRepo;
  const repo = new BriefRepository(container.db);
  return new BriefService({
    store: repo,
    pulls: {
      getPull: async (workspaceId, prId) => {
        const p = await review().getPull(workspaceId, prId);
        return p
          ? {
              id: p.id,
              workspaceId: p.workspaceId,
              repoId: p.repoId,
              number: p.number,
              title: p.title,
              branch: p.branch,
              base: p.base,
              headSha: p.headSha,
              body: p.body,
              status: p.status,
              additions: p.additions,
              deletions: p.deletions,
              filesCount: p.filesCount,
            }
          : undefined;
      },
      getRepo: async (repoId) => {
        const r = await review().getRepo(repoId);
        return r ? { id: r.id, owner: r.owner, name: r.name } : undefined;
      },
      getFiles: async (prId) =>
        (await review().getPrFiles(prId)).map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
      getCommits: async (prId) => (await review().getPrCommits(prId)).map((c) => ({ message: c.message })),
    },
    github: {
      getPullDetail: async (repo, n) => (await container.github()).getPullRequest(repo, n),
      getIssue: async (repo, n) => (await container.github()).getIssue(repo, n),
    },
    git: {
      readFileAtRef: (repo, ref, path, maxBytes) => container.git.readFileAtRef(repo, ref, path, maxBytes),
      fetchPullHead: (repo, n, opts) => container.git.fetchPullHead(repo, n, opts),
    },
    models: {
      resolve: (workspaceId, id) => container.featureModel(workspaceId, id),
      llm: (provider) => container.llm(provider),
      // "Configured" = the client can be constructed; no model is called.
      isConfigured: async (workspaceId) => {
        const choice = await container.featureModel(workspaceId, 'review_intent');
        try {
          await container.llm(choice.provider);
          return true;
        } catch (err) {
          if (err instanceof ConfigError) return false;
          throw err;
        }
      },
    },
    // Reads the store directly (NOT container.automaticBrief, which delegates back to this service).
    settings: { autoBrief: async (workspaceId) => resolveAutomaticBrief(await repo.readAutomaticSetting(workspaceId)) },
    jobs: { enqueue: (workspaceId, payload) => container.briefJobs.enqueue(workspaceId, BRIEF_JOB_KIND, payload) },
    diff: { parse: (raw) => container.parseDiff(raw) },
    // Late-bound: app.ts assigns container.logger after the container is built.
    log: {
      debug: (o, m) => container.logger.debug(o, m),
      info: (o, m) => container.logger.info(o, m),
      warn: (o, m) => container.logger.warn(o, m),
    },
    autoBriefEnabled: container.config.autoBriefEnabled,
  });
}

function isDerivePayload(p: unknown): p is DerivePayload {
  const o = p as Partial<DerivePayload> | null;
  return (
    !!o &&
    typeof o.workspaceId === 'string' &&
    typeof o.prId === 'string' &&
    typeof o.trigger === 'string' &&
    typeof o.enqueuedAt === 'string'
  );
}

/** Register the `brief.derive` handler (a thin driving adapter). Call once at plugin boot. */
export function registerBriefJobs(container: Container): void {
  container.briefJobs.register(BRIEF_JOB_KIND, async (payload) => {
    if (!isDerivePayload(payload)) return;
    // derive() never throws.
    await container.prBrief.derive(payload.workspaceId, payload.prId, payload);
  });
}
