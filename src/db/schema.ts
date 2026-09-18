import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Offsets into a meeting are integer milliseconds everywhere. See SPEC.md section 4.

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const EMBEDDING_DIMENSIONS = 768;

export const meetingSource = pgEnum("meeting_source", ["scheduled", "instant", "upload", "paste"]);
export const meetingStatus = pgEnum("meeting_status", [
  "scheduled",
  "recording",
  "processing",
  "ready",
  "failed",
]);
export const chunkKind = pgEnum("chunk_kind", ["transcript", "note"]);
export const actionItemOrigin = pgEnum("action_item_origin", ["ai", "manual"]);
export const askRole = pgEnum("ask_role", ["user", "assistant"]);

// ---------------------------------------------------------------- JSON shapes

export type TemplateSection = { key: string; title: string; instruction: string };

export type SummaryBullet = {
  text: string;
  /** Transcript offsets this bullet is grounded in. Empty when it comes only from notes. */
  source_ms: number[];
  /** True when the Scratchpad changed or added this bullet. */
  from_notes: boolean;
};

export type SummaryContent = {
  overview: string;
  sections: { key: string; title: string; bullets: SummaryBullet[] }[];
};

export type AskScope = { meeting_ids?: string[]; person?: string; from?: string; to?: string };

export type Citation = {
  n: number;
  meeting_id: string;
  chunk_id: string;
  start_ms: number;
  speaker: string | null;
  quote: string;
};

// --------------------------------------------------------------------- tables

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  avatarColor: text("avatar_color").notNull().default("#0F766E"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sections: jsonb("sections").$type<TemplateSection[]>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms").notNull().default(0),
    source: meetingSource("source").notNull(),
    status: meetingStatus("status").notNull().default("processing"),
    error: text("error"),
    audioUrl: text("audio_url"),
    timestampsEstimated: boolean("timestamps_estimated").notNull().default(false),
    activeTemplateId: uuid("active_template_id").references(() => templates.id),
    shareSlug: text("share_slug").notNull().unique(),
    shareEnabled: boolean("share_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meetings_owner_started_idx").on(t.ownerId, t.startedAt.desc())],
);

export const participants = pgTable(
  "participants",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.name] })],
);

/** The source of truth every timestamp link resolves to. */
export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    speaker: text("speaker").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("transcript_segments_meeting_idx").on(t.meetingId, t.idx)],
);

/**
 * Retrieval units for Ask Meetscribe. Transcript chunks span segments seg_from..seg_to.
 * Scratchpad notes are chunked here too (kind = 'note') so answers can cite them;
 * note chunks have no segment range and no offsets.
 */
export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    kind: chunkKind("kind").notNull().default("transcript"),
    segFrom: integer("seg_from"),
    segTo: integer("seg_to"),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    speakerLabel: text("speaker_label"),
    text: text("text").notNull(),
    // Nullable: if the embedding call fails the chunk is still findable by full-text search.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', "text")`),
  },
  (t) => [
    index("transcript_chunks_meeting_idx").on(t.meetingId, t.kind),
    index("transcript_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("transcript_chunks_tsv_idx").using("gin", t.tsv),
  ],
);

export const summaries = pgTable(
  "summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id),
    content: jsonb("content").$type<SummaryContent>().notNull(),
    /** scratchpads.version that was fed into this generation. 0 = no notes existed. */
    notesVersionUsed: integer("notes_version_used").notNull().default(0),
    /** The model that actually produced it, so a provider fallback is visible. */
    model: text("model").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One current summary per (meeting, template). Older versions are kept with is_current = false.
    uniqueIndex("summaries_current_idx")
      .on(t.meetingId, t.templateId)
      .where(sql`${t.isCurrent}`),
    index("summaries_meeting_idx").on(t.meetingId, t.createdAt.desc()),
  ],
);

export const scratchpads = pgTable("scratchpads", {
  meetingId: uuid("meeting_id")
    .primaryKey()
    .references(() => meetings.id, { onDelete: "cascade" }),
  content: text("content").notNull().default(""),
  /** Incremented on every save. Compared with summaries.notes_version_used to detect stale summaries. */
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actionItems = pgTable(
  "action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    assigneeName: text("assignee_name"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    done: boolean("done").notNull().default(false),
    sourceMs: integer("source_ms"),
    origin: actionItemOrigin("origin").notNull().default("ai"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("action_items_meeting_idx").on(t.meetingId, t.sortOrder)],
);

export const askThreads = pgTable("ask_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: jsonb("scope").$type<AskScope>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const askMessages = pgTable(
  "ask_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => askThreads.id, { onDelete: "cascade" }),
    role: askRole("role").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ask_messages_thread_idx").on(t.threadId, t.createdAt)],
);

/** Stretch feature. Table exists now so adding it later needs no migration. */
export const highlights = pgTable(
  "highlights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    startMs: integer("start_ms").notNull(),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("highlights_meeting_idx").on(t.meetingId, t.startMs)],
);

export type User = typeof users.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type Summary = typeof summaries.$inferSelect;
export type Scratchpad = typeof scratchpads.$inferSelect;
export type ActionItem = typeof actionItems.$inferSelect;
