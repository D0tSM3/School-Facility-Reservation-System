-- CampusRoom: promote the reservation category out of the purpose text.
-- Business Rules Revision 2, Section 2 + Schema impact.
--
-- BEFORE: the booking form wrote the category into `purpose` as a string
--         prefix — "Student Org Meeting: weekly assembly" — so the category
--         could only be recovered by parsing text, and a requester who happened
--         to type that prefix themselves was indistinguishable from the real
--         thing.
-- AFTER:  `category` is a real ENUM column. `purpose` holds only the
--         requester's own description.
--
-- NOTE ON THE ENUM VALUE 'Exam/Quiz': the old text prefix was "Exam / Quiz"
-- (spaces around the slash); the column value is "Exam/Quiz" per the rules
-- doc. The backfill below maps the old spelling onto the new value.
--
-- The backfill is a ONE-TIME data fix. Re-running this file is harmless for
-- normal data: rows are only touched while they still carry a prefix, and the
-- strip removes it. (A requester who literally types "Academic Lecture: " at
-- the start of a description would have it stripped on a second run — worth
-- knowing, not worth guarding for a file that runs once.)
--
--   mysql -uroot campusroom < migrations/2026-09-20_reservation_category.sql

-- 1. The column -------------------------------------------------------------
ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS category
        ENUM('Academic Lecture','Faculty Defense','Student Org Meeting','Dept Workshop','Exam/Quiz')
        NOT NULL DEFAULT 'Academic Lecture' AFTER purpose;

-- 2. Backfill from the old prefix, pass 1: set the category ------------------
UPDATE Reservations SET category = 'Academic Lecture'   WHERE purpose LIKE 'Academic Lecture: %';
UPDATE Reservations SET category = 'Faculty Defense'    WHERE purpose LIKE 'Faculty Defense: %';
UPDATE Reservations SET category = 'Student Org Meeting' WHERE purpose LIKE 'Student Org Meeting: %';
UPDATE Reservations SET category = 'Dept Workshop'      WHERE purpose LIKE 'Dept Workshop: %';
UPDATE Reservations SET category = 'Exam/Quiz'          WHERE purpose LIKE 'Exam / Quiz: %';
UPDATE Reservations SET category = 'Exam/Quiz'          WHERE purpose LIKE 'Exam/Quiz: %';

-- 3. Backfill pass 2: strip the prefix off `purpose` -------------------------
-- Guarded so a purpose that is ONLY a prefix never becomes the empty string
-- (the column is NOT NULL and an empty purpose would fail the API's own
-- "purpose is required" rule on any later edit).
UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Academic Lecture') + 3))
 WHERE purpose LIKE 'Academic Lecture: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Academic Lecture') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Faculty Defense') + 3))
 WHERE purpose LIKE 'Faculty Defense: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Faculty Defense') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Student Org Meeting') + 3))
 WHERE purpose LIKE 'Student Org Meeting: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Student Org Meeting') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Dept Workshop') + 3))
 WHERE purpose LIKE 'Dept Workshop: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Dept Workshop') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam / Quiz') + 3))
 WHERE purpose LIKE 'Exam / Quiz: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam / Quiz') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam/Quiz') + 3))
 WHERE purpose LIKE 'Exam/Quiz: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam/Quiz') + 3)) <> '';

-- 4. Retire requestor_type ---------------------------------------------------
-- Revision 2 replaces the two-value Individual/Student-Organization field with
-- the five-value category above. This is a no-op unless the earlier plan's
-- column was actually created.
ALTER TABLE Reservations DROP COLUMN IF EXISTS requestor_type;
