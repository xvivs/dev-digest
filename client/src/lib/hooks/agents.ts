/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import type {
  Agent,
  AgentSkillLink,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/* ---- Agent ↔ skill links (SPEC-02) ---- */

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SetAgentSkillsInput {
  agentId: string;
  /** Full ordered list; order = index. */
  links: { skill_id: string; enabled: boolean }[];
}

/**
 * The Skills tab (SPEC-02) autosaves on a debounce, so two `mutate()` calls
 * from the SAME `useSetAgentSkills()` instance can be in flight at once (a
 * slow save, then a newer one right after). TanStack Query only invokes a
 * per-call `mutate(vars, { onSuccess })` for whichever dispatch its observer
 * currently tracks (the latest one) — an older, superseded dispatch's
 * per-call callback silently never fires. The hook-level `onSuccess` below is
 * NOT subject to that: it fires once per dispatch regardless, which is
 * exactly why `onMutate`'s generation counter has to guard IT — otherwise a
 * slow, superseded response still wins the cache write if it resolves last.
 * `options.meta` lets a caller opt into ADR 0011's local error surface, same
 * as `useAddRepo`/`useTestConnection`. See SkillsTab.tsx for the rest of the
 * autosave flow (immediate optimistic UI feedback, rollback, coalescing).
 */
export function useSetAgentSkills(options?: MutationHookOptions) {
  const qc = useQueryClient();
  const genRef = useRef(0);
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ agentId, links }: SetAgentSkillsInput) =>
      api.put<AgentSkillLink[]>(`/agents/${agentId}/skills`, { links }),
    onMutate: () => ({ gen: ++genRef.current }),
    onSuccess: (data, { agentId }, context) => {
      if (context && context.gen !== genRef.current) return; // superseded by a newer dispatch; this response is stale
      qc.setQueryData(["agent-skills", agentId], data);
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
