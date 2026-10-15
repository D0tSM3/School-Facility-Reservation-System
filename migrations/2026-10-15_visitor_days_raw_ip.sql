-- WARNING: Recreating this table empties all existing visitor-day data.
-- Take a backup and dry-run with ROLLBACK; first.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.visitor_days;

CREATE TABLE public.visitor_days (
  day            date         NOT NULL,
  ip_address     varchar(45)  NOT NULL,
  page           varchar(16)  NOT NULL
    CHECK (page IN ('landing', 'login', 'activate')),
  hits           integer      NOT NULL DEFAULT 1 CHECK (hits > 0),
  first_seen     timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen      timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  browser_family varchar(16)  NOT NULL
    CHECK (browser_family IN ('Chrome', 'Firefox', 'Safari', 'Edge', 'script/other')),
  PRIMARY KEY (day, ip_address, page)
);

CREATE INDEX IF NOT EXISTS visitor_days_day_page_idx
  ON public.visitor_days (day, page);

ALTER TABLE public.visitor_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.visitor_days FROM anon, authenticated;

COMMIT;
