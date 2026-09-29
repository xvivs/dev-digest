/* PrSourcePicker — "From PR": repository → synced pull request → the files
   whose patches go into the case. The server snapshots those patches into
   `input_diff`, so a later push to the PR never changes the case. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRepos, usePulls, usePullDetail } from "@/lib/hooks";
import { s } from "./styles";

export function PrSourcePicker({
  prId,
  files,
  onChange,
}: {
  prId: string | null;
  files: readonly string[];
  onChange: (next: { prId: string | null; files: readonly string[] }) => void;
}) {
  const t = useTranslations("eval");
  const ids = { repo: React.useId(), pr: React.useId(), files: React.useId() };
  const repos = useRepos();
  const [repoId, setRepoId] = React.useState<string>("");
  const pulls = usePulls(repoId || null);
  const detail = usePullDetail(prId);
  // Only synced PRs have an id the server can resolve (`pr_id` is a PrMeta.id).
  const prs = (pulls.data ?? []).filter((p): p is typeof p & { id: string } => !!p.id);

  const toggle = (path: string) =>
    onChange({ prId, files: files.includes(path) ? files.filter((f) => f !== path) : [...files, path] });

  return (
    <div style={s.wrap}>
      <div style={s.field}>
        <label htmlFor={ids.repo} style={s.label}>
          {t("skillEvals.caseModal.repo")}
        </label>
        {repos.isSuccess && repos.data.length === 0 ? (
          <p style={s.hint}>{t("skillEvals.caseModal.noRepos")}</p>
        ) : (
          <select
            id={ids.repo}
            value={repoId}
            onChange={(e) => {
              setRepoId(e.target.value);
              onChange({ prId: null, files: [] });
            }}
            style={s.select}
          >
            <option value="">{t("skillEvals.caseModal.repoPlaceholder")}</option>
            {(repos.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {repoId && (
        <div style={s.field}>
          <label htmlFor={ids.pr} style={s.label}>
            {t("skillEvals.caseModal.pr")}
          </label>
          {pulls.isSuccess && prs.length === 0 ? (
            <p style={s.hint}>{t("skillEvals.caseModal.noPrs")}</p>
          ) : (
            <select id={ids.pr} value={prId ?? ""} onChange={(e) => onChange({ prId: e.target.value || null, files: [] })} style={s.select}>
              <option value="">{t("skillEvals.caseModal.prPlaceholder")}</option>
              {prs.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("skillEvals.caseModal.prOption", { number: p.number, title: p.title })}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {prId && (
        <fieldset aria-describedby={ids.files} style={s.fieldset}>
          <legend style={s.label}>{t("skillEvals.caseModal.files")}</legend>
          <span id={ids.files} style={s.hint}>
            {t("skillEvals.caseModal.filesHint")}
          </span>
          {detail.isLoading ? (
            <p style={s.hint}>{t("skillEvals.caseModal.loadingPr")}</p>
          ) : (
            <ul style={s.files}>
              {(detail.data?.files ?? []).map((f) => (
                <li key={f.path}>
                  <label style={s.file}>
                    <input type="checkbox" checked={files.includes(f.path)} onChange={() => toggle(f.path)} />
                    <span className="mono" style={s.path}>
                      {f.path}
                    </span>
                    <span style={s.stats}>{t("skillEvals.caseModal.fileStats", { additions: f.additions, deletions: f.deletions })}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </div>
  );
}
