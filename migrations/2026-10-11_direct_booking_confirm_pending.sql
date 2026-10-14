-- CampusRoom: direct-booking cutover — auto-confirm existing Pending bookings.
-- (PostgreSQL / Supabase.)
--
-- WHY
--   CampusRoom has retired the Staff/Admin approval queue: every new booking is
--   confirmed immediately (ReservationController::approvalOutcome now always
--   returns ['Approved','auto']). Any reservation still sitting in 'Pending'
--   was waiting on a queue that no longer exists, so this migration confirms
--   those rows the same way a fresh booking would be confirmed today.
--
-- SAFETY
--   The prevent_double_booking trigger blocks overlaps across BOTH 'Pending'
--   and 'Approved', so no two Pending rows can already overlap — flipping every
--   Pending row to Approved cannot create a double-booking.
--
--   Nothing is dropped. ConflictOverrideRequests / move-request /
--   ReservationCancellationRequests history is left untouched.
--
-- TRACEABILITY
--   One System_Logs entry is written per confirmed booking (attributed to the
--   booking's own customer) before the status flip, so the audit trail records
--   why each row changed.
--
-- IDEMPOTENT: after the first run no 'Pending' rows remain, so re-running
-- affects zero rows. Run it in the Supabase SQL editor (or apply directly in
-- development).

BEGIN;

-- 1. Audit every Pending booking that is about to be auto-confirmed.
INSERT INTO System_Logs (user_id, reservation_id, action_type)
SELECT customer_id,
       reservation_id,
       'Auto-confirmed on direct-booking migration (approval queue retired)'
  FROM Reservations
 WHERE status = 'Pending';

-- 2. Confirm them: Pending -> Approved, recorded as an automatic approval.
UPDATE Reservations
   SET status = 'Approved',
       approval_type = 'auto'
 WHERE status = 'Pending';

COMMIT;
