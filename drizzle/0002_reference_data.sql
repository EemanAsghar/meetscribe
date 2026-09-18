-- Reference data the app cannot run without: the demo user, teammates (assignees and speakers),
-- and the four summary templates. Fixed ids so the statements are idempotent.

INSERT INTO "users" ("id", "name", "email", "avatar_color", "is_demo") VALUES
  ('00000000-0000-4000-8000-000000000001', 'Eeman Asghar', 'demo@meetscribe.app', '#0F766E', true),
  ('00000000-0000-4000-8000-000000000002', 'Priya Raman', 'priya@northwind.example', '#7C3AED', false),
  ('00000000-0000-4000-8000-000000000003', 'Marcus Oyelaran', 'marcus@northwind.example', '#B45309', false),
  ('00000000-0000-4000-8000-000000000004', 'Lena Fischer', 'lena@northwind.example', '#0369A1', false),
  ('00000000-0000-4000-8000-000000000005', 'Tomás Ibarra', 'tomas@northwind.example', '#BE185D', false)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "templates" ("id", "slug", "name", "description", "sort_order", "sections") VALUES
  ('00000000-0000-4000-9000-000000000001', 'general', 'General', 'A balanced recap that works for any meeting.', 0,
   '[{"key":"key_points","title":"Key points","instruction":"The 4 to 7 most important things said, in the order they came up. One sentence each."},
     {"key":"decisions","title":"Decisions","instruction":"Only things the group actually agreed on. If nothing was decided, return no bullets."},
     {"key":"next_steps","title":"Next steps","instruction":"What happens after this meeting. Name the owner when one was stated."}]'::jsonb),
  ('00000000-0000-4000-9000-000000000002', 'enhanced', 'Enhanced', 'Detailed notes grouped by topic, with context, risks and open questions.', 1,
   '[{"key":"context","title":"Context","instruction":"Why this meeting happened and what was at stake. 1 to 3 bullets."},
     {"key":"discussion","title":"Discussion by topic","instruction":"Group the conversation into its real topics. One bullet per topic, starting with the topic name and a colon, then what was said and by whom."},
     {"key":"decisions","title":"Decisions and rationale","instruction":"Each decision with the reason given for it. Include numbers and dates exactly as stated."},
     {"key":"risks","title":"Risks and concerns","instruction":"Anything raised as a worry, blocker or disagreement, and who raised it."},
     {"key":"open_questions","title":"Open questions","instruction":"Questions that were asked and not resolved."},
     {"key":"next_steps","title":"Next steps","instruction":"What happens next, with owner and date when stated."}]'::jsonb),
  ('00000000-0000-4000-9000-000000000003', 'sales-discovery', 'Sales Discovery', 'Customer call notes: pains, requirements, buying process, objections.', 2,
   '[{"key":"customer","title":"Customer situation","instruction":"Who the customer is, their current tooling and what prompted the conversation."},
     {"key":"pains","title":"Pain points","instruction":"Problems the customer described, in their own terms. Quote short phrases where useful."},
     {"key":"requirements","title":"Requirements","instruction":"Must-haves and nice-to-haves the customer stated. Mark each as must-have or nice-to-have."},
     {"key":"buying","title":"Buying process","instruction":"Budget, timeline, decision makers and competing options, only as far as they were stated."},
     {"key":"objections","title":"Objections","instruction":"Hesitations or pushback, and how they were answered, if they were."},
     {"key":"next_steps","title":"Next steps","instruction":"Agreed follow-ups on both sides, with dates."}]'::jsonb),
  ('00000000-0000-4000-9000-000000000004', 'standup', 'Standup', 'Per-person progress, plans and blockers. Short.', 3,
   '[{"key":"progress","title":"Done since last time","instruction":"One bullet per person, starting with their name and a colon. Only finished work."},
     {"key":"plans","title":"Working on next","instruction":"One bullet per person, starting with their name and a colon."},
     {"key":"blockers","title":"Blockers","instruction":"Anything stopping someone, who is blocked, and who can unblock them. If none, return no bullets."}]'::jsonb)
ON CONFLICT ("id") DO NOTHING;
