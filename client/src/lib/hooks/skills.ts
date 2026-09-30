/* hooks/skills.ts — React Query hooks for the Skills page (SPEC-02). */
"use client";

import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MutationHookOptions } from "../query-client";
import type { Skill, SkillListItem, SkillType } from "@devdigest/shared";
// Value import (ADR 0007 response validation). The subpath keeps the bundle to
// this contract and its siblings instead of the whole `@devdigest/shared`
// barrel; `next.config.mjs` maps its `.js` specifiers back to `.ts`.
import {
  RestoreSkillVersionResult,
  SkillStats,
  type SkillStatsWindow,
  SkillVersion,
  SkillVersionSummary,
  type UpdateSkillBody,
} from "@devdigest/shared/contracts/skill-impact";

/** Snapshots are append-only (ADR 0016): once fetched, one never changes. */
const IMMUTABLE_STALE_TIME = Infinity;
const SKILL_VERSION_LIST = SkillVersionSummary.array();

/** Query keys shared by the skill hooks — one place so invalidation cannot drift. */
export const skillKeys = {
  list: ["skills"] as const,
  detail: (id: string) => ["skill", id] as const,
  versions: (id: string) => ["skill-versions", id] as const,
  version: (id: string, version: number) => ["skill-version", id, version] as const,
  /** Prefix of every window's stats: invalidating it refreshes all of them. */
  stats: (id: string) => ["skill-stats", id] as const,
  statsWindow: (id: string, window: SkillStatsWindow) => ["skill-stats", id, window] as const,
  agentSkills: ["agent-skills"] as const,
};

export function useSkills(q?: string) {
  const query = q?.trim() ?? "";
  return useQuery({
    queryKey: ["skills", query],
    queryFn: () => api.get<SkillListItem[]>(query ? `/skills?q=${encodeURIComponent(query)}` : "/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  /** 'imported' makes the server store it disabled + needs_vetting (ADR 0012). */
  source?: "manual" | "imported";
}

/** `options.meta` opts into ADR 0011's local error surface (import drawer). */
export function useCreateSkill(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  /** `change_note` is the optional "What changed" text stored on the new version. */
  patch: UpdateSkillBody;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: skillKeys.list });
      qc.invalidateQueries({ queryKey: skillKeys.agentSkills });
      // A content edit appends a version (ADR 0016).
      qc.invalidateQueries({ queryKey: skillKeys.versions(data.id) });
      qc.setQueryData(skillKeys.detail(data.id), data);
    },
  });
}

/** `GET /skills/:id/versions` — snapshots without bodies, newest first (ADR 0016). */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.versions(id ?? ""),
    queryFn: () => api.get<SkillVersionSummary[]>(`/skills/${id}/versions`, SKILL_VERSION_LIST),
    enabled: !!id,
  });
}

/** `GET /skills/:id/versions/:version` — one full snapshot. 404 = body unavailable. */
export function useSkillVersion(id: string | null | undefined, version: number | null | undefined) {
  return useQuery({
    queryKey: skillKeys.version(id ?? "", version ?? 0),
    queryFn: () => api.get<SkillVersion>(`/skills/${id}/versions/${version}`, SkillVersion),
    enabled: !!id && version != null,
    staleTime: IMMUTABLE_STALE_TIME,
    // A missing snapshot is an expected answer, not a blip worth retrying.
    retry: false,
  });
}

/**
 * `GET /skills/:id/stats?window=` — usage, cost and impact (Phase 2).
 * `placeholderData` keeps the previous window's numbers on screen while the
 * next window loads, so the 7d/30d/90d switcher does not flash a skeleton.
 */
export function useSkillStats(id: string | null | undefined, window: SkillStatsWindow) {
  return useQuery({
    queryKey: skillKeys.statsWindow(id ?? "", window),
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats?window=${window}`, SkillStats),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  /** The snapshot to restore. */
  version: number;
  /** The skill's CURRENT version as this screen saw it; a mismatch is 409 `skill_version_stale`. */
  expectedVersion: number;
}

/**
 * `POST /skills/:id/versions/:version/restore` (ADR 0016 "Restore" path).
 * `options.meta` lets the Restore popup own the error (ADR 0011): a 409 there
 * reads "skill changed — reload", not a generic toast.
 */
export function useRestoreSkillVersion(options?: MutationHookOptions) {
  const qc = useQueryClient();
  return useMutation({
    meta: options?.meta,
    mutationFn: ({ id, version, expectedVersion }: RestoreSkillVersionInput) =>
      api.post<RestoreSkillVersionResult>(
        `/skills/${id}/versions/${version}/restore`,
        { expected_version: expectedVersion },
        RestoreSkillVersionResult,
      ),
    onSuccess: ({ skill }, { id }) => {
      qc.setQueryData(skillKeys.detail(id), skill);
      qc.invalidateQueries({ queryKey: skillKeys.detail(id) });
      qc.invalidateQueries({ queryKey: skillKeys.versions(id) });
      qc.invalidateQueries({ queryKey: skillKeys.stats(id) });
      qc.invalidateQueries({ queryKey: skillKeys.list });
      qc.invalidateQueries({ queryKey: skillKeys.agentSkills });
    },
  });
}

/** Mark an imported skill as reviewed and trusted (ADR 0012). */
export function useVetSkill() {
  const qc = useQueryClient();
  return useMutation({
    // `version` = the body version the person reviewed; the server refuses
    // (409) if the body changed since, so nobody vets text they never saw.
    mutationFn: ({ id, version }: { id: string; version: number }) => api.post<Skill>(`/skills/${id}/vet`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}
