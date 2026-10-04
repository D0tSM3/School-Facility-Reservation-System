-- CampusRoom: staff facility suggestions (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   FacilitySuggestions — when Staff review a booking whose range partially
--   conflicts (some days are fine, one day clashes with a class or another
--   reservation), instead of rejecting the whole thing they can suggest moving
--   just the conflicting day to an alternative room that matches the original
--   criteria and is free at that time. The customer then Accepts or Declines
--   (see the PATCH endpoint / my-reservations.html).
--
--   status is a plain VARCHAR + CHECK rather than the request_status enum,
--   because this flow's verbs are Accepted/Declined (the customer's answer),
--   not the Approved/Rejected of the staff-decided request tables.
--
-- SAFE TO RE-RUN: IF NOT EXISTS throughout. Run it in the Supabase SQL editor
-- (or it is applied directly during development).

CREATE TABLE IF NOT EXISTS FacilitySuggestions (
    suggestion_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id         UUID NOT NULL REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    original_room_id       UUID NOT NULL REFERENCES Rooms(room_id),
    suggested_room_id      UUID NOT NULL REFERENCES Rooms(room_id),
    affected_date          DATE NOT NULL,
    reason                 VARCHAR(500) NOT NULL,
    status                 VARCHAR(20) NOT NULL DEFAULT 'Pending'
                           CHECK (status IN ('Pending','Accepted','Declined')),
    suggested_by           UUID NOT NULL REFERENCES Users(user_id),
    responded_at           TIMESTAMP NULL,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The customer's "do I have a suggestion to answer?" lookup joins through the
-- reservation; staff list open suggestions and check "is one already pending
-- for this booking?". Both filter on status + reservation.
CREATE INDEX IF NOT EXISTS idx_facsug_reservation ON FacilitySuggestions (reservation_id);
CREATE INDEX IF NOT EXISTS idx_facsug_status      ON FacilitySuggestions (status, created_at);
