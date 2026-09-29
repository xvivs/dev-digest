/**
 * COMPOSITION — the evals module's composition root (server/AGENTS.md:53-54:
 * job handlers are registered by kind at wiring time). The only module file
 * that pairs the service with the concrete repository and adapts the
 * container's shared seams to the service's ports:
 *
 *   EvalPrSource      ← container.reviewRepo (synced PR + pr_files)
 *   EvalSkillResolver ← container.skillsRepo.resolveEffectiveSkills
 *   DiffParser        ← container.parseDiff
 *   EvalReviewer      ← reviewer-core `reviewPullRequest` + container.llm
 *   EvalJobQueue      ← container.evalJobs (dedicated runner, ADR 0018)
 *   PriceEstimator    ← container.priceBook
 */
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { EvalsRepository } from './repository.js';
import { EvalsService } from './service.js';
import type { EvalJobPayload, EvalLogger, EvalReviewer } from './ports.js';
import { EVAL_RUN_JOB_KIND } from './constants.js';

function reviewerFor(container: Container): EvalReviewer {
  return {
    async review(input) {
      const llm = await container.llm(input.provider);
      // No repo-intel context and no PR description: eval runs see the case
      // diff, the carrier prompt and the arm's skills only (ADR 0017 limits).
      const outcome = await reviewPullRequest({
        systemPrompt: input.systemPrompt,
        model: input.model,
        diff: container.parseDiff(input.diffRaw),
        llm,
        strategy: input.strategy,
        ...(input.skills.length > 0 ? { skills: input.skills.map((s) => ({ name: s.name, body: s.body })) } : {}),
        task: input.task,
        sessionId: input.sessionId,
        checkCancelled: input.checkCancelled,
      });
      return {
        findings: outcome.review.findings,
        grounding: outcome.grounding,
        tokensIn: outcome.tokensIn,
        tokensOut: outcome.tokensOut,
        costUsd: outcome.costUsd,
        costSource: outcome.costSource,
        raw: outcome.raw,
      };
    },
  };
}

/**
 * Builds THE evals service of this container and registers its job handler.
 * Call once per container (the route plugin does): the handler and the
 * routes must share one instance, because cancellation is an in-memory set.
 */
export function buildEvalsService(container: Container, log?: EvalLogger): EvalsService {
  const service = new EvalsService({
    store: new EvalsRepository(container.db),
    prs: {
      getPull: async (workspaceId, prId) => {
        const pull = await container.reviewRepo.getPull(workspaceId, prId);
        return pull ? { id: pull.id, number: pull.number, headSha: pull.headSha } : undefined;
      },
      getPrFiles: async (prId) =>
        (await container.reviewRepo.getPrFiles(prId)).map((f) => ({ path: f.path, patch: f.patch })),
    },
    skills: {
      effectiveSkills: async (agentId) =>
        ((await container.skillsRepo.resolveEffectiveSkills([agentId])).get(agentId) ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          body: s.body,
        })),
    },
    diffs: {
      files: (raw) =>
        container.parseDiff(raw).files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    },
    reviewer: reviewerFor(container),
    queue: {
      enqueue: async (workspaceId, payload, timeoutMs) => {
        const job = await container.evalJobs.enqueue(workspaceId, EVAL_RUN_JOB_KIND, payload, { timeoutMs });
        // The handler never throws, so `done` rejects only when the per-job
        // timeout fires. The model call keeps running (ADR 0018), but the run
        // is failed and counted now so the suite can close without a reboot.
        job.done.catch(() => service.timeOutJob(payload, timeoutMs));
      },
    },
    price: (model, tokensIn, tokensOut) => container.priceBook.estimate(model, tokensIn, tokensOut),
    maxBudgetUsd: container.config.evalMaxBudgetUsd,
    ...(log ? { log } : {}),
  });
  container.evalJobs.register(EVAL_RUN_JOB_KIND, (payload) => service.runJob(payload as EvalJobPayload));
  return service;
}
