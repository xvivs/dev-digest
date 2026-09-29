/* Pure logic for TransformToSkillModal. */
import { ApiError } from "@/lib/api";

/** What went wrong creating the skill, in the terms the modal renders it. */
export type CreateError =
  | { kind: "name" }
  | { kind: "budget"; agentId: string | null }
  | { kind: "notAccepted" }
  | { kind: "generic"; message: string };

const CONFLICT_STATUS = 409;
const UNPROCESSABLE_STATUS = 422;

function agentIdFrom(details: unknown): string | null {
  if (typeof details !== "object" || details === null || !("agent_id" in details)) return null;
  return typeof details.agent_id === "string" ? details.agent_id : null;
}

/** Maps a failed `POST /repos/:id/conventions/skills` onto the modal's inline errors (AC-27, AC-28, AC-25). */
export function classifyCreateError(err: unknown): CreateError {
  if (err instanceof ApiError) {
    if (err.status === CONFLICT_STATUS && err.code === "skill_name_taken") return { kind: "name" };
    if (err.status === UNPROCESSABLE_STATUS && err.code === "agent_skills_budget_exceeded") {
      return { kind: "budget", agentId: agentIdFrom(err.details) };
    }
    if (err.status === UNPROCESSABLE_STATUS && err.code === "convention_not_accepted") return { kind: "notAccepted" };
    return { kind: "generic", message: err.message };
  }
  return { kind: "generic", message: err instanceof Error ? err.message : "" };
}

export interface ModalFields {
  name: string;
  description: string;
  enabled: boolean;
  body: string;
  agentIds: readonly string[];
}

/** Whether the form differs from what the modal opened with (AC-46). */
export function isModalDirty(initial: ModalFields, current: ModalFields): boolean {
  return (
    initial.name !== current.name ||
    initial.description !== current.description ||
    initial.enabled !== current.enabled ||
    initial.body !== current.body ||
    initial.agentIds.length !== current.agentIds.length ||
    initial.agentIds.some((id, i) => id !== current.agentIds[i])
  );
}
