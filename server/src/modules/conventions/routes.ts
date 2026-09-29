/**
 * PRESENTATION — the HTTP driving adapter of the conventions extractor
 * (specs/02-conventions.md § API). parse (zod on the route) → service → DTO.
 * No Drizzle, no repository, no business branching beyond mapping a service
 * `undefined` to `NotFoundError`.
 *
 *   POST  /repos/:id/conventions/extract   → 202 {scan_id}            (rate limit 5/min)
 *   GET   /repos/:id/conventions           → ConventionsPage
 *   PATCH /conventions/:id                 → ConventionCandidate
 *   POST  /repos/:id/conventions/skills    → 201 {skill, linked_agent_ids}
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionCandidate,
  ConventionsPage,
  CreateSkillFromConventionsResponse,
  UpdateConventionBody,
  type ConventionCandidate as ConventionCandidateDto,
  type ConventionScan as ConventionScanDto,
  type Skill as SkillDto,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SkillBody, SkillDescription, SkillName } from '../_shared/skill-rules.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ConventionView, CreatedSkill, ScanRecord } from './domain.js';
import { wireConventions } from './wiring.js';

/** Stricter than the shared contract: shared skill rules + uuid ids (AC-6). */
const CreateSkillBody = z
  .object({
    name: SkillName,
    description: SkillDescription.optional(),
    body: SkillBody,
    enabled: z.boolean(),
    convention_ids: z.array(z.string().uuid()).min(1).max(50),
    agent_ids: z.array(z.string().uuid()).max(20),
  })
  .strict();

const ExtractResponse = z.object({ scan_id: z.string() });

function toScanDto(s: ScanRecord): ConventionScanDto {
  return {
    id: s.id,
    repo_id: s.repoId,
    status: s.status,
    commit_sha: s.commitSha,
    error: s.error,
    sample_file_count: s.sampleFileCount,
    found_count: s.foundCount,
    verified_count: s.verifiedCount,
    dropped_count: s.droppedCount,
    relocated_count: s.relocatedCount,
    matched_prior_count: s.matchedPriorCount,
    duplicate_count: s.duplicateCount,
    retry_count: s.retryCount,
    model: s.model,
    tokens_in: s.tokensIn,
    tokens_out: s.tokensOut,
    cost_usd: s.costUsd,
    cost_source: s.costSource,
    started_at: s.startedAt.toISOString(),
    finished_at: s.finishedAt?.toISOString() ?? null,
    duration_ms: s.finishedAt ? s.finishedAt.getTime() - s.startedAt.getTime() : null,
  };
}

function toCandidateDto(v: ConventionView, latestDoneScanId: string | null): ConventionCandidateDto {
  const o = v.observation;
  return {
    id: v.id,
    repo_id: v.repoId,
    status: v.status,
    category: v.category,
    origin: v.origin,
    rule: v.rule,
    original_rule: v.originalRule,
    edited: v.editedAt !== null,
    evidence: (o?.evidence ?? []).map((e) => ({
      path: e.path,
      line_start: e.lineStart,
      line_end: e.lineEnd,
      snippet: e.snippet,
    })),
    support_count: o?.supportCount ?? 0,
    counter_count: o?.counterCount ?? 0,
    review_hits: o?.reviewHits ?? 0,
    confidence: o?.confidence ?? 0,
    seen_in_latest: latestDoneScanId !== null && v.lastSeenScanId === latestDoneScanId,
    last_seen_commit_sha: v.lastSeenCommitSha,
    skills: v.skills,
    created_at: v.createdAt.toISOString(),
  };
}

function toSkillDto(s: CreatedSkill): SkillDto {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    type: s.type,
    source: s.source,
    body: s.body,
    enabled: s.enabled,
    version: s.version,
    evidence_files: s.evidenceFiles,
    needs_vetting: s.needsVetting,
    updated_at: s.updatedAt.toISOString(),
  };
}

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = wireConventions(app.container);

  // Tight per-route limit: every call can start an LLM scan.
  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams, response: { 202: ExtractResponse } },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const started = await service.startScan(workspaceId, req.params.id);
      if (!started) throw new NotFoundError('Repo not found');
      return reply.status(202).send({ scan_id: started.scanId });
    },
  );

  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams, response: { 200: ConventionsPage } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const page = await service.getPage(workspaceId, req.params.id);
      if (!page) throw new NotFoundError('Repo not found');
      const latestDoneId = page.latestDoneScan?.id ?? null;
      return {
        last_scan: page.lastScan ? toScanDto(page.lastScan) : null,
        running_scan: page.runningScan ? toScanDto(page.runningScan) : null,
        latest_done_scan: page.latestDoneScan ? toScanDto(page.latestDoneScan) : null,
        candidates: page.candidates.map((c) => toCandidateDto(c, latestDoneId)),
      };
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody, response: { 200: ConventionCandidate } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.update(workspaceId, req.params.id, req.body);
      if (!updated) throw new NotFoundError('Convention not found');
      return toCandidateDto(updated.candidate, updated.latestDoneScanId);
    },
  );

  app.post(
    '/repos/:id/conventions/skills',
    { schema: { params: IdParams, body: CreateSkillBody, response: { 201: CreateSkillFromConventionsResponse } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const b = req.body;
      const created = await service.createSkill(workspaceId, req.params.id, {
        name: b.name,
        body: b.body,
        enabled: b.enabled,
        conventionIds: b.convention_ids,
        agentIds: b.agent_ids,
        ...(b.description !== undefined ? { description: b.description } : {}),
      });
      return reply.status(201).send({ skill: toSkillDto(created.skill), linked_agent_ids: created.linkedAgentIds });
    },
  );
}
