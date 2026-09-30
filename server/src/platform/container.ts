import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  FeatureModelChoice,
  FeatureModelId,
  UnifiedDiff,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db, DbTx } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { resolveFeatureModel } from '../modules/settings/feature-models.js';
import { EvalsRepository } from '../modules/evals/repository.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import type { PrBriefFacade } from '../modules/brief/types.js';
import { buildBriefService } from '../modules/brief/wiring.js';
import { resolveAutomaticBrief } from '../modules/brief/domain.js';
import { readAutomaticBriefSetting } from '../modules/brief/repository.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
  /** PR brief facade — tests inject spies / stubs (import triggers, review pre-work). */
  prBrief?: PrBriefFacade;
}

/** Minimal structural logger (Fastify's `app.log` satisfies it). */
export interface ContainerLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

const NOOP_LOGGER: ContainerLogger = { debug() {}, info() {}, warn() {} };

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  /**
   * ADR 0018: a dedicated runner so eval load never starves real reviews.
   * Concurrency 2, no job-level retries (adapters already retry, a retry here
   * would double-spend). Eval jobs pass their own timeout per enqueue, sized
   * from the diff's chunk count; the default below is only a backstop.
   */
  readonly evalJobs: JobRunner;
  /**
   * ADR 0022: a dedicated runner for PR brief derivation, so it never starves
   * clone and index jobs on `jobs`. One job at a time and no retries (a retry
   * would pay the LLM twice); 150 s backstop over the 45 + 60 s phase budgets.
   */
  readonly briefJobs: JobRunner;
  readonly runBus: RunBus;
  /** Structured logger for services built here. No-op until app.ts assigns `app.log`. */
  logger: ContainerLogger = NOOP_LOGGER;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _skillsRepo?: SkillsRepository;
  private _evalsRepo?: EvalsRepository;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _prBrief?: PrBriefFacade;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
    this.evalJobs = new JobRunner(db, { concurrency: 2, retries: 0, timeoutMs: 30 * 60_000 });
    this.briefJobs = new JobRunner(db, { concurrency: 1, retries: 0, timeoutMs: 150_000 });
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  /**
   * Fresh, UNCACHED repositories bound to a transaction handle. Use inside
   * `db.transaction(tx => ...)` — the memoized getters above are bound to the
   * root `db` and would silently escape the transaction.
   */
  skillsRepoOn(tx: DbTx): SkillsRepository {
    return new SkillsRepository(tx);
  }

  agentsRepoOn(tx: DbTx): AgentsRepository {
    return new AgentsRepository(tx);
  }

  /** Resolve a feature id to provider+model (workspace override, else default). */
  featureModel(workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice> {
    return resolveFeatureModel(this, workspaceId, id);
  }

  /**
   * Effective workspace `automatic_brief` (missing row = ON). Uncached, like
   * `featureModel`: a Settings change applies to the next sync without a restart.
   */
  async automaticBrief(workspaceId: string): Promise<boolean> {
    return resolveAutomaticBrief(await readAutomaticBriefSetting(this.db, workspaceId));
  }

  /**
   * The PR brief facade (intent + risk areas). ONE memoized instance: it keeps
   * queued/in-flight state that routes, the job handler and the review executor
   * must share. Tests inject a stub via `ContainerOverrides.prBrief`.
   */
  get prBrief(): PrBriefFacade {
    if (this.overrides.prBrief) return this.overrides.prBrief;
    this._prBrief ??= buildBriefService(this);
    return this._prBrief;
  }

  /** Eval suites read model; the skills Stats tab reads `impact` through it. */
  get evalsRepo(): EvalsRepository {
    return (this._evalsRepo ??= new EvalsRepository(this.db));
  }

  /** Pure unified-diff parser (the same one the git adapter uses). */
  parseDiff(raw: string): UnifiedDiff {
    return parseUnifiedDiff(raw);
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
