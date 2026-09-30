import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// 'imported' = uploaded .md/.zip (SPEC-02). 'imported_url' / 'community' are
// reserved for later lessons and unused: no server-side fetch (ADR 0012).
export const SkillSource = z.enum(['manual', 'imported', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  // Imported skills start unvetted and never reach a prompt until a person
  // vets them; editing an imported skill's body resets it (ADR 0012).
  needs_vetting: z.boolean().default(false),
  updated_at: z.string().nullish(),
});
export type Skill = z.infer<typeof Skill>;

/**
 * Ablation-eval verdict for a skill (ADR 0017). `indicative` = too few
 * non-flaky cases or a Quick suite; `unknown` = no suite has finished.
 */
export const ImpactVerdict = z.enum(['helps', 'neutral', 'hurts', 'indicative', 'unknown']);
export type ImpactVerdict = z.infer<typeof ImpactVerdict>;

/** Latest Full-suite verdict shown on the skill card. */
export const SkillLatestVerdict = z.object({
  verdict: ImpactVerdict,
  carrier_name: z.string(),
  /** The skill's prompt_sha256 or the carrier's version changed since the suite ran. */
  stale: z.boolean(),
});
export type SkillLatestVerdict = z.infer<typeof SkillLatestVerdict>;

/**
 * `GET /skills` row: the skill plus how many agents link it, its completed
 * runs over the last 30 days and the latest Full eval verdict (null = no
 * evals). The server always sends `runs_30d` and `latest_verdict`; they are
 * optional only so payloads from before skill-impact still parse.
 */
export const SkillListItem = Skill.extend({
  agent_count: z.number().int(),
  runs_30d: z.number().int().nonnegative().optional(),
  latest_verdict: SkillLatestVerdict.nullish(),
});
export type SkillListItem = z.infer<typeof SkillListItem>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'async',
  'typing',
  'testing',
  'imports',
  'api',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionOrigin = z.enum(['code', 'review_history']);
export type ConventionOrigin = z.infer<typeof ConventionOrigin>;

/** One verified quote from the repo at the scan's pinned commit. */
export const ConventionEvidence = z.object({
  path: z.string(),
  line_start: z.number().int(),
  line_end: z.number().int(),
  snippet: z.string(),
});
export type ConventionEvidence = z.infer<typeof ConventionEvidence>;

export const ConventionScanStatus = z.enum(['running', 'done', 'failed']);
export type ConventionScanStatus = z.infer<typeof ConventionScanStatus>;

export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: ConventionScanStatus,
  commit_sha: z.string().nullable(),
  error: z.string().nullable(),
  sample_file_count: z.number().int(),
  found_count: z.number().int(),
  verified_count: z.number().int(),
  dropped_count: z.number().int(),
  relocated_count: z.number().int(),
  matched_prior_count: z.number().int(),
  duplicate_count: z.number().int(),
  retry_count: z.number().int(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  cost_source: z.enum(['provider', 'estimated']).nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** A stable per-repo identity plus its latest observation (evidence, counts, confidence). */
export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string(),
  status: ConventionStatus,
  category: ConventionCategory,
  origin: ConventionOrigin,
  rule: z.string(),
  original_rule: z.string(),
  edited: z.boolean(),
  evidence: z.array(ConventionEvidence),
  support_count: z.number().int(),
  counter_count: z.number().int(),
  review_hits: z.number().int(),
  confidence: z.number().min(0).max(1),
  seen_in_latest: z.boolean(),
  last_seen_commit_sha: z.string().nullable(),
  skills: z.array(z.object({ id: z.string(), name: z.string() })),
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

export const ConventionsPage = z.object({
  last_scan: ConventionScan.nullable(),
  running_scan: ConventionScan.nullable(),
  latest_done_scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsPage = z.infer<typeof ConventionsPage>;

/** `PATCH /conventions/:id`. Strict; at least one field. */
export const UpdateConventionBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(8).max(300).optional(),
    category: ConventionCategory.optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.rule !== undefined || b.category !== undefined, {
    message: 'At least one of status, rule, category is required',
  });
export type UpdateConventionBody = z.infer<typeof UpdateConventionBody>;

/** `POST /repos/:id/conventions/skills`. */
export const CreateSkillFromConventionsBody = z.object({
  name: z.string(),
  description: z.string().optional(),
  body: z.string(),
  enabled: z.boolean(),
  convention_ids: z.array(z.string()).min(1).max(50),
  agent_ids: z.array(z.string()).max(20),
});
export type CreateSkillFromConventionsBody = z.infer<typeof CreateSkillFromConventionsBody>;

export const CreateSkillFromConventionsResponse = z.object({
  skill: Skill,
  linked_agent_ids: z.array(z.string()),
});
export type CreateSkillFromConventionsResponse = z.infer<typeof CreateSkillFromConventionsResponse>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  // Number of enabled skill links (SPEC-02). Optional so single-agent payloads
  // that don't compute it still parse.
  skill_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  // Per-agent toggle; a disabled link keeps its position (SPEC-02 D1).
  enabled: z.boolean(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
  // Full link state at snapshot time (SPEC-02). Absent on versions written
  // before L02, hence nullish.
  skill_links: z
    .array(z.object({ skill_id: z.string(), enabled: z.boolean(), order: z.number().int() }))
    .nullish(),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
