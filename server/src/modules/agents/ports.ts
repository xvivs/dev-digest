/**
 * PORTS — what the agents service needs from persistence, declared by the
 * inner ring. `repository.ts` implements `AgentStore` with Drizzle; the
 * service unit test implements it in memory.
 */
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
import type { LinkableSkill, SkillLinkInput } from './domain.js';

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkill {
  skill: { id: string };
  order: number;
  enabled: boolean;
}

export interface AgentStore {
  list(workspaceId: string): Promise<(AgentRow & { skillCount: number })[]>;
  skillCountFor(agentId: string): Promise<number>;
  getById(workspaceId: string, id: string): Promise<AgentRow | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  insert(values: InsertAgent): Promise<AgentRow>;
  update(workspaceId: string, id: string, patch: UpdateAgent): Promise<AgentRow | undefined>;
  listVersions(agentId: string): Promise<AgentVersionRow[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined>;
  linkedSkills(agentId: string): Promise<LinkedSkill[]>;
  /** Skills of `workspaceId` among `skillIds` — foreign ids are simply absent. */
  findWorkspaceSkills(workspaceId: string, skillIds: string[]): Promise<LinkableSkill[]>;
  /** Delete the agent's links and insert `links` (order = array index). */
  replaceSkillLinks(agentId: string, links: SkillLinkInput[]): Promise<void>;
  /**
   * Run `work` atomically. The store handed to `work` is bound to the
   * transaction — use it, not `this`, inside the callback.
   */
  transaction<T>(work: (store: AgentStore) => Promise<T>): Promise<T>;
}
