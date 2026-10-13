BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS event_type      varchar(40),
  ADD COLUMN IF NOT EXISTS ip_address      varchar(45),
  ADD COLUMN IF NOT EXISTS identifier_hash char(16),
  ADD COLUMN IF NOT EXISTS user_agent      varchar(200);
CREATE INDEX IF NOT EXISTS system_logs_event_time_idx
  ON public.system_logs (event_type, "timestamp" DESC) WHERE event_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_logs_ip_time_idx
  ON public.system_logs (ip_address, "timestamp" DESC) WHERE ip_address IS NOT NULL;
COMMIT;
