export interface ArchivedRun {
  id: string;
  workspaceId: string;
  findingCount: number;
}

export interface ArchiveStore {
  findRun(workspaceId: string, runId: string): Promise<ArchivedRun | undefined>;
  deleteFindings(runId: string): Promise<number>;
  deleteRun(runId: string): Promise<boolean>;
  transaction<T>(work: (store: ArchiveStore) => Promise<T>): Promise<T>;
}
