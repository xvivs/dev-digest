/* What a finding card in the Files changed tab needs from DiffTab: which paths
   are in the diff, a way to jump to one, and the GitHub coordinates for paths
   that are not. A context because the card is rendered by the diff viewer's
   `Card` slot, which only passes the finding. `null` outside DiffTab. */
import React from "react";

export interface DiffNav {
  /** Paths of the PR's files. */
  paths: ReadonlySet<string>;
  openFile: (path: string, line: number) => void;
  repoFullName: string | null;
  headSha: string;
}

export const DiffNavContext = React.createContext<DiffNav | null>(null);
