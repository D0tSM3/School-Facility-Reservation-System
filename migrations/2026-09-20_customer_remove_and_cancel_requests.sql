-- CampusRoom: customer-side "Remove" + cancellation requests for approved bookings.
--
-- WHAT THIS ADDS
--   1. Reservations.customer_hidden — the soft "Remove". The customer's list
--      stops showing the booking; staff, the calendar and the audit log are
--      unaffected. Nothing is ever deleted, so a removed booking can still be
--      explained later ("who withdrew this request, and when?").
--   2. ReservationCancelRequests — an approved booking can no longer be
--      cancelled by the customer directly. They file a request with a reason,
--      staff approve or reject it, and approving is what cancels the booking.
--      Modelled on ReservationMoveRequests, which already works this way.
--
-- SAFE TO RE-RUN: purely additive and guarded with IF NOT EXISTS. No rows are
-- changed or deleted.
--
--   mysql -uroot campusroom < migrations/2026-09-20_customer_remove_and_cancel_requests.sql
--
-- Run 2026-09-20_sync_reservation_schema.sql first if you have not already.

-- 1. Soft remove -------------------------------------------------------------
-- 0 = visible in My Reservations, 1 = the customer removed it from their list.
ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS customer_hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- findByCustomer() filters on (customer_id, customer_hidden) every page load.
CREATE INDEX IF NOT EXISTS idx_res_customer_hidden
    ON Reservations (customer_id, customer_hidden);

-- 2. Cancellation requests ---------------------------------------------------
CREATE TABLE IF NOT EXISTS ReservationCancelRequests (
    request_id     CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    reservation_id CHAR(36)     NOT NULL,
    reason         VARCHAR(500) NOT NULL,
    status         ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    staff_comment  VARCHAR(500) NULL DEFAULT NULL,
    processed_by   CHAR(36)     NULL DEFAULT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cancelreq_reservation FOREIGN KEY (reservation_id)
        REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancelreq_processor   FOREIGN KEY (processed_by)
        REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- "latest request for this booking" (customer badge) and the staff queue.
CREATE INDEX IF NOT EXISTS idx_cancelreq_reservation
    ON ReservationCancelRequests (reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancelreq_status
    ON ReservationCancelRequests (status);
