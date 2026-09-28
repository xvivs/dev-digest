import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { now } from "./_shared";
import { workspaces } from "./core";

/** One list for the Drizzle enum type AND the DB CHECK, so they can't drift. */
const SKILL_SOURCES = ["manual", "imported", "imported_url", "extracted", "community"] as const;

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    type: text("type", {
      enum: ["rubric", "convention", "security", "custom"],
    }).notNull(),
    source: text("source", { enum: SKILL_SOURCES }).notNull(),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    evidenceFiles: jsonb("evidence_files").$type<string[]>(),
    // ADR 0012: imported skills start unvetted; vetting stores the body hash so
    // a later body edit is detectable.
    needsVetting: boolean("needs_vetting").notNull().default(false),
    vettedBodyHash: text("vetted_body_hash"),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameUq: uniqueIndex("skills_workspace_name_uq").on(t.workspaceId, t.name),
    // The column is `text`; without this only Drizzle types and zod guard it.
    sourceCheck: check(
      "skills_source_check",
      sql`${t.source} IN (${sql.raw(SKILL_SOURCES.map((v) => `'${v}'`).join(", "))})`,
    ),
  }),
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
