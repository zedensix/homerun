ALTER TABLE "instance_settings" ADD COLUMN "build_cpu_limit" double precision;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "build_memory_limit_mb" integer;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "build_cpu_limit" double precision;--> statement-breakpoint
ALTER TABLE "remote_host" ADD COLUMN "build_memory_limit_mb" integer;