/**
 * PRESENTATION — the HTTP driving adapter of the evals module (plan Phase 3,
 * specs/03-skill-impact-api.md). parse (zod on the route) → service → DTO.
 *
 *   GET    /skills/:id/eval-cases     → SkillEvalCase[]
 *   POST   /skills/:id/eval-cases     → 201 SkillEvalCase (paste diff or PR files)
 *   PUT    /eval-cases/:id            → SkillEvalCase (partial; new source re-snapshots)
 *   DELETE /eval-cases/:id            → { ok: true }
 *   GET    /skills/:id/eval-carriers  → EvalCarrier[] (enabled links only, default first)
 *   GET    /skills/:id/eval-suites    → EvalSuite[], newest first
 *   POST   /skills/:id/eval-suites    → 201 EvalSuite (status 'estimated'; nothing runs)
 *   POST   /eval-suites/:id/start     → EvalSuite (single-use; a replay is a no-op)
 *   POST   /eval-suites/:id/cancel    → EvalSuite (terminal → no-op)
 *   GET    /eval-suites/:id           → EvalSuiteDetail (the polling target)
 *   GET    /eval-cases/:id            → EvalCaseDetail (the eval drawer; ?suite_id= optional)
 *
 * Registration also boots the module: the job handler is registered in
 * `wiring.ts`, then `recoverOnBoot` runs before the server accepts requests
 * (same reasoning as run reaping in app.ts).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateEvalCaseBody,
  CreateEvalSuiteBody,
  EvalCaseDetailQuery,
  UpdateEvalCaseBody,
  type EvalCarrier as EvalCarrierDto,
  type EvalCaseDetail as EvalCaseDetailDto,
  type EvalSuite as EvalSuiteDto,
  type EvalSuiteDetail as EvalSuiteDetailDto,
  type EvalSuiteRun as EvalSuiteRunDto,
  type SkillEvalCase as SkillEvalCaseDto,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { isPartialSuite, toEvalSuiteDto } from '../_shared/eval-suite.js';
import { NotFoundError } from '../../platform/errors.js';
import type { EvalCase, EvalRunRecord } from './domain.js';
import { buildEvalsService } from './wiring.js';
import { caseDiffPreview } from './domain.js';
import type { EvalCaseDetailResult } from './service.js';

/**
 * The contract requires `carrier_agent_id`; the server also accepts it
 * missing and then picks the plan's default carrier (the enabled-link agent with
 * the most runs with the skill). A strict superset of the wire contract.
 */
const CreateSuiteBody = CreateEvalSuiteBody.extend({
  carrier_agent_id: z.string().uuid().optional(),
}).strict();

function toCaseDto(c: EvalCase): SkillEvalCaseDto {
  return {
    id: c.id,
    owner_kind: c.ownerKind,
    owner_id: c.ownerId,
    name: c.name,
    input_diff: c.inputDiff,
    input_files: c.inputFiles,
    input_meta: c.inputMeta,
    expected_output: c.expectedOutput,
    notes: c.notes,
    skill_id: c.skillId,
    expectation: c.expectation,
    input_source: c.inputSource,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

function toCaseDetailDto(d: EvalCaseDetailResult): EvalCaseDetailDto {
  const c = d.case;
  const diff = caseDiffPreview(c.inputDiff);
  return {
    case: {
      id: c.id,
      skill_id: c.skillId,
      name: c.name,
      notes: c.notes,
      expectation: c.expectation,
      input_source: c.inputSource,
      input_files: Array.isArray(c.inputFiles) ? c.inputFiles.filter((f): f is string => typeof f === 'string') : [],
      input_diff_preview: diff.preview,
      input_diff_chars: diff.chars,
      input_diff_truncated: diff.truncated,
      created_at: c.createdAt.toISOString(),
      updated_at: c.updatedAt.toISOString(),
    },
    suite: d.suite && {
      id: d.suite.id,
      mode: d.suite.mode,
      status: d.suite.status,
      carrier_name: d.suite.carrierName,
      skill_version: d.suite.skillVersion,
      repeats: d.suite.repeats,
      stale: d.suite.stale,
      partial: isPartialSuite(d.suite),
      created_at: d.suite.createdAt.toISOString(),
    },
    arms: d.arms,
    outcome: d.outcome,
    expectation_changed: d.expectationChanged,
    history: d.history.map((h) => ({
      suite_id: h.suite.id,
      created_at: h.suite.createdAt.toISOString(),
      mode: h.suite.mode,
      outcome: h.outcome,
      skill_version: h.suite.skillVersion,
      stale: h.suite.stale,
      partial: isPartialSuite(h.suite),
    })),
  };
}

function toRunDto(r: EvalRunRecord): EvalSuiteRunDto {
  return {
    id: r.id,
    suite_id: r.suiteId,
    case_id: r.caseId,
    arm: r.arm,
    repeat_idx: r.repeatIdx,
    status: r.status,
    pass: r.status === 'done' ? r.pass : null,
    matched: r.matched,
    expected: r.expected,
    unexpected: r.unexpected,
    citation_accuracy: r.citationAccuracy,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    cost_usd: r.costUsd,
    cost_source: r.costSource,
    duration_ms: r.durationMs,
    error: r.error,
    ran_at: r.ranAt?.toISOString() ?? null,
  };
}

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = buildEvalsService(app.container, app.log);

  try {
    const recovered = await service.recoverOnBoot();
    if (recovered.orphaned + recovered.requeued + recovered.closed > 0) {
      app.log.info(recovered, 'eval suites recovered on boot');
    }
  } catch (err) {
    app.log.warn({ err: (err as Error).message }, 'eval boot recovery failed (non-fatal)');
  }

  // ---- cases

  app.get('/skills/:id/eval-cases', { schema: { params: IdParams } }, async (req): Promise<SkillEvalCaseDto[]> => {
    const { workspaceId } = await getContext(app.container, req);
    const cases = await service.listCases(workspaceId, req.params.id);
    if (!cases) throw new NotFoundError('Skill not found');
    return cases.map(toCaseDto);
  });

  app.post(
    '/skills/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply): Promise<SkillEvalCaseDto> => {
      const { workspaceId } = await getContext(app.container, req);
      const created = await service.createCase(workspaceId, req.params.id, req.body);
      if (!created) throw new NotFoundError('Skill not found');
      reply.status(201);
      return toCaseDto(created);
    },
  );

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody } },
    async (req): Promise<SkillEvalCaseDto> => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Eval case not found');
      return toCaseDto(updated);
    },
  );

  app.get(
    '/eval-cases/:id',
    { schema: { params: IdParams, querystring: EvalCaseDetailQuery } },
    async (req): Promise<EvalCaseDetailDto> => {
      const { workspaceId } = await getContext(app.container, req);
      const detail = await service.getCaseDetail(workspaceId, req.params.id, {
        ...(req.query.suite_id ? { suiteId: req.query.suite_id } : {}),
      });
      if (!detail) throw new NotFoundError('Eval case not found');
      return toCaseDetailDto(detail);
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ---- suites

  app.get('/skills/:id/eval-carriers', { schema: { params: IdParams } }, async (req): Promise<EvalCarrierDto[]> => {
    const { workspaceId } = await getContext(app.container, req);
    const carriers = await service.listCarriers(workspaceId, req.params.id);
    if (!carriers) throw new NotFoundError('Skill not found');
    return carriers.map((c) => ({ agent_id: c.agentId, agent_name: c.agentName, runs: c.runs, is_default: c.isDefault }));
  });

  app.get('/skills/:id/eval-suites', { schema: { params: IdParams } }, async (req): Promise<EvalSuiteDto[]> => {
    const { workspaceId } = await getContext(app.container, req);
    const suites = await service.listSuites(workspaceId, req.params.id);
    if (!suites) throw new NotFoundError('Skill not found');
    return suites.map(toEvalSuiteDto);
  });

  app.post(
    '/skills/:id/eval-suites',
    { schema: { params: IdParams, body: CreateSuiteBody } },
    async (req, reply): Promise<EvalSuiteDto> => {
      const { workspaceId } = await getContext(app.container, req);
      const suite = await service.createSuite(workspaceId, req.params.id, {
        mode: req.body.mode,
        ...(req.body.case_ids ? { caseIds: req.body.case_ids } : {}),
        ...(req.body.carrier_agent_id ? { carrierAgentId: req.body.carrier_agent_id } : {}),
      });
      if (!suite) throw new NotFoundError('Skill not found');
      reply.status(201);
      return toEvalSuiteDto(suite);
    },
  );

  app.post('/eval-suites/:id/start', { schema: { params: IdParams } }, async (req): Promise<EvalSuiteDto> => {
    const { workspaceId } = await getContext(app.container, req);
    const suite = await service.startSuite(workspaceId, req.params.id);
    if (!suite) throw new NotFoundError('Eval suite not found');
    return toEvalSuiteDto(suite);
  });

  app.post('/eval-suites/:id/cancel', { schema: { params: IdParams } }, async (req): Promise<EvalSuiteDto> => {
    const { workspaceId } = await getContext(app.container, req);
    const suite = await service.cancelSuite(workspaceId, req.params.id);
    if (!suite) throw new NotFoundError('Eval suite not found');
    return toEvalSuiteDto(suite);
  });

  app.get('/eval-suites/:id', { schema: { params: IdParams } }, async (req): Promise<EvalSuiteDetailDto> => {
    const { workspaceId } = await getContext(app.container, req);
    const detail = await service.getSuiteDetail(workspaceId, req.params.id);
    if (!detail) throw new NotFoundError('Eval suite not found');
    return { ...toEvalSuiteDto(detail.suite), cases: detail.cases, runs: detail.runs.map(toRunDto) };
  });
}
