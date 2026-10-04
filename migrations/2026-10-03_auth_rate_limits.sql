-- CampusRoom: Rate limiting & timeout mechanism for failed authentication attempts.
--
-- Tracks failed attempts and active lockouts for:
-- 1. Login (wrong credentials)
-- 2. Registration OTP verification (wrong OTP code)
-- 3. Forgot Password OTP verification (wrong OTP code)
--

create table if not exists auth_rate_limits (
   rate_key        varchar(190) primary key,
   action          varchar(64) not null,
   identifier      varchar(255) not null,
   failed_attempts int not null default 1,
   locked_until    timestamp not null,
   updated_at      timestamp not null default current_timestamp
);

create index if not exists idx_rate_limits_action on
   auth_rate_limits (
      action
   );
create index if not exists idx_rate_limits_locked on
   auth_rate_limits (
      locked_until
   );