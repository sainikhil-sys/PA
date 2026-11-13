-- Hand-written tail of the connect_on_spaces migration (connect_keys, space_notes, space_rooms,
-- space_room_presence). After regenerating the migration, add the statement-breakpoint marker to the end
-- of its last generated line, then append this file unchanged.
-- Row-level security on the new tables, like every other table since 0015.
ALTER TABLE "connect_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_room_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase's API roles get no grants at all on these tables (skipped where the roles don't exist, e.g. local Postgres).
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['connect_keys', 'space_notes', 'space_rooms', 'space_room_presence'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;
