CREATE TABLE "rate_limit_hits" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
