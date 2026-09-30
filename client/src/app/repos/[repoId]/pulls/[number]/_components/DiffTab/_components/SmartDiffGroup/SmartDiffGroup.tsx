/* SmartDiffGroup — one role group of the Files changed tab: a sticky header
   (chevron, colour square, label, description, findings counter, file count)
   over the group's files. An empty group is a static muted row: no button, no
   chevron, no body. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Disclosure, Icon } from "@devdigest/ui";
import { COLLAPSED_ROLES, ROLE_META } from "../../constants";
import type { RoleGroup } from "../../helpers";
import { chevronFor, s, squareFor } from "./styles";

export function SmartDiffGroup({
  group,
  filesWithFindings,
  children,
}: {
  group: RoleGroup;
  /** Files of this group with an active finding; null while no review exists. */
  filesWithFindings: number | null;
  children?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const meta = ROLE_META[group.role];
  const count = t("smartDiff.filesCount", { count: group.files.length });

  const label = (
    <>
      <span aria-hidden="true" style={squareFor(meta.color)} />
      <span style={s.label}>{t(meta.labelKey)}</span>
      <span style={s.desc}>{t(meta.descKey)}</span>
    </>
  );

  if (group.isEmpty) {
    return (
      <section style={s.wrapper}>
        <div style={s.headerEmpty}>
          {label}
          <span style={s.right}>
            <span className="tnum" style={s.count}>
              {count}
            </span>
          </span>
        </div>
      </section>
    );
  }

  return (
    <section style={s.wrapper}>
      <Disclosure
        defaultOpen={!COLLAPSED_ROLES.has(group.role)}
        headerStyle={s.header}
        header={(open) => (
          <>
            <Icon.ChevronRight size={13} style={chevronFor(open)} aria-hidden="true" />
            {label}
            <span style={s.right}>
              {filesWithFindings != null && filesWithFindings > 0 && (
                <span
                  role="img"
                  aria-label={t("smartDiff.filesWithFindings", { count: filesWithFindings })}
                  style={s.findings}
                >
                  <span aria-hidden="true" style={s.findingsDot} />
                  <span className="tnum">{filesWithFindings}</span>
                </span>
              )}
              <span className="tnum" style={s.count}>
                {count}
              </span>
            </span>
          </>
        )}
      >
        {children}
      </Disclosure>
    </section>
  );
}
