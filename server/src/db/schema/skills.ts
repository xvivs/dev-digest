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

/** One list per column for the Drizzle enum type AND the DB CHECK, so they can't drift. */
const SKILL_TYPES = ["rubric", "convention", "security", "custom"] as const;
const SKILL_SOURCES = ["manual", "imported", "imported_url", "extracted", "community"] as const;
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    type: text("type", { enum: SKILL_TYPES }).notNull(),
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
    // Both columns are `text`; without these only Drizzle types and zod guard them.
    typeCheck: check("skills_type_check", sql`${t.type} IN (${inList(SKILL_TYPES)})`),
    sourceCheck: check("skills_source_check", sql`${t.source} IN (${inList(SKILL_SOURCES)})`),
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
    // ADR 0016: every versioned field is snapshotted. Nullable because rows
    // written before the all-field migration captured only the body.
    name: text("name"),
    description: text("description"),
    type: text("type", { enum: SKILL_TYPES }),
    changeNote: text("change_note"),
    createdAt: now(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.version] }),
    typeCheck: check(
      "skill_versions_type_check",
      sql`${t.type} IS NULL OR ${t.type} IN (${inList(SKILL_TYPES)})`,
    ),
  }),
);
