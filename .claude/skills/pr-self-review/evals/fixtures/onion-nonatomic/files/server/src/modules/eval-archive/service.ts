import type { ArchiveStore } from './ports.js';

export class ArchiveService {
  constructor(private readonly store: ArchiveStore) {}

  /** Removes a run together with its findings. */
  async archive(workspaceId: string, runId: string): Promise<boolean> {
    const run = await this.store.findRun(workspaceId, runId);
    if (!run) return false;
    await this.store.deleteFindings(run.id);
    return this.store.deleteRun(run.id);
  }
}
