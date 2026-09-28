/* hooks/skills.ts — React Query hooks for the Skills page (SPEC-02). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, SkillListItem, SkillType } from "@devdigest/shared";

export function useSkills(q?: string) {
  const query = q?.trim() ?? "";
  return useQuery({
    queryKey: ["skills", query],
    queryFn: () =>
      api.get<SkillListItem[]>(query ? `/skills?q=${encodeURIComponent(query)}` : "/skills"),
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

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

/** Mark an imported skill as reviewed and trusted (ADR 0012). */
export function useVetSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Skill>(`/skills/${id}/vet`),
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
