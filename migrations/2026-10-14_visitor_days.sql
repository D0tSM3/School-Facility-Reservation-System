-- Daily, privacy-preserving landing/login/activation page-load summaries.
-- Do not run automatically; review and apply through the approved migration process.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.visitor_days (
  day            date         NOT NULL,
  visitor_hash   char(16)     NOT NULL,
  page           varchar(16)  NOT NULL
    CHECK (page IN ('landing', 'login', 'activate')),
  hits           integer      NOT NULL DEFAULT 1 CHECK (hits > 0),
  first_seen     timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen      timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  browser_family varchar(16)  NOT NULL
    CHECK (browser_family IN ('Chrome', 'Firefox', 'Safari', 'Edge', 'script/other')),
  PRIMARY KEY (day, visitor_hash, page)
);

CREATE INDEX IF NOT EXISTS visitor_days_day_page_idx
  ON public.visitor_days (day, page);

ALTER TABLE public.visitor_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.visitor_days FROM anon, authenticated;

COMMIT;
