/* CommentCard — one review comment rendered as a Card with avatar + markdown
   body. Used by CommentThreadView and OutdatedComments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Card, Avatar, Markdown } from "@devdigest/ui";
import type { PrReviewComment } from "@/lib/types";
import { LocalTime } from "@/components/local-time";
import { safeExternalHref } from "../helpers";
import { cs } from "../styles";

export function CommentCard({ c }: { c: PrReviewComment }) {
  const t = useTranslations("diffViewer");
  const href = safeExternalHref(c.html_url);
  return (
    <Card>
      <div style={cs.headRow}>
        <Avatar name={c.user} size={20} />
        <span style={cs.user}>{c.user}</span>
        <LocalTime iso={c.created_at} style={cs.time} />
        <span style={cs.spacer} />
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" style={cs.ghLink}>
            <Icon.ExternalLink size={12} />
            {t("viewOnGitHub")}
          </a>
        )}
      </div>
      <div style={cs.mdBody}>
        <Markdown safe>{c.body}</Markdown>
      </div>
    </Card>
  );
}
