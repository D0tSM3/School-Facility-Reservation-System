# Phase 2: Database and Backend Implementation Documentation

This document outlines the technical implementation details for Phase 2 of the CampusRoom Reservation System, which covers the database schema, entity relationships, CRUD operations, authentication, and the core backend architecture.

---

## 1. Database and Tables

The system uses a PostgreSQL database hosted on Supabase. The schema is designed to enforce data integrity at the database level.

### Implemented Tables
*   **Users (Strong Entity):** Stores user credentials and role assignments.
    *   Fields: `user_id` (UUID, Primary Key), `email` (Unique), `password_hash`, `role` (Enum: Admin, Staff, Customer), `created_at`.
*   **Rooms (Strong Entity):** Stores physical spaces available for reservation.
    *   Fields: `room_id` (UUID, Primary Key), `name`, `capacity`, `is_active` (Boolean), `status` (Available, Maintenance), `created_at`.
*   **Reservations (Associative Entity):** Links Users to Rooms for specific time windows.
    *   Fields: `reservation_id` (UUID, Primary Key), `customer_id` (Foreign Key), `room_id` (Foreign Key), `start_time`, `end_time`, `status` (Pending, Approved, Rejected, Completed), `processed_by` (Foreign Key), `created_at`.
*   **System_Logs (Weak Entity):** An audit trail for administrative and booking actions.
    *   Fields: `log_id` (UUID, Primary Key), `user_id` (Foreign Key), `action_type`, `timestamp`.

---

## 2. Relationships and Constraints

The database enforces business rules to prevent orphaned records and logically inconsistent states:

*   **Foreign Keys:** `Reservations` holds foreign keys referencing both `Users` (the customer who booked it) and `Rooms`. It also holds an optional `processed_by` foreign key referencing the Staff/Admin who approved or rejected the booking.
*   **Cascading Deletes:** Deleting a User or a Room will cascade and remove associated Reservations and System Logs to maintain referential integrity.
*   **Concurrency Control (No Double-Booking):** A custom PostgreSQL trigger (`prevent_double_booking`) is attached to the `Reservations` table. It automatically checks for overlapping approved or pending reservations for the same room before allowing an INSERT or UPDATE. If a collision is detected, it raises an exception (`SQLSTATE P0001`), which the PHP backend safely catches and converts to an HTTP 409 Conflict error.

---

## 3. CRUD Operations

CRUD (Create, Read, Update, Delete) functionality is handled through the Repository Pattern in the PHP backend, separating SQL queries from the HTTP routing logic.

*   **Users:**
    *   *Create:* Registration of new Customer accounts.
    *   *Read:* Admin fetching a list of all users.
    *   *Update:* Admin changing a user's role (e.g., promoting a Customer to Staff).
*   **Rooms:**
    *   *Create:* Admin adding new facilities to the system.
    *   *Read:* Customers fetching all active rooms. The live "Occupied" status is dynamically derived at query-time rather than stored statically.
    *   *Update:* Admin changing a room's status to "Maintenance" or deactivating it.
*   **Reservations:**
    *   *Create:* Customers submitting a new booking request.
    *   *Read:* Customers viewing their own booking history; Staff viewing pending queues.
    *   *Update:* Staff approving, rejecting, or completing a reservation.

---

## 4. Authentication and Authorization

The backend implements secure, session-based authentication without relying on external frameworks.

*   **Password Security:** All user passwords are encrypted using `bcrypt` (`password_hash()`) before being stored. Passwords are never returned in any API response.
*   **Session Management:** Upon successful login, the user's `user_id` and `role` are stored in a secure PHP session. The session ID is regenerated (`session_regenerate_id()`) during login to prevent session fixation attacks.
*   **Role-Based Access Control (RBAC):** A central `Auth::requireRole()` helper is invoked at the very beginning of every protected endpoint. This guarantees that a Customer cannot access Staff or Admin routes, returning an HTTP 403 Forbidden error if unauthorized.

---

## 5. Basic Backend Architecture

The backend was built using vanilla PHP 8+ following a standard three-tier architecture (Client, Application Logic, Database).

*   **Front-Controller Pattern:** All incoming HTTP requests are funneled through a single entry point (`public/index.php`). This file contains a centralized routing table using regular expressions to match URLs to specific Controller methods.
*   **Database Abstraction (PDO):** The application connects to PostgreSQL using PHP Data Objects (PDO). A Singleton `Database` class manages the connection.
*   **Prepared Statements:** To completely eliminate the risk of SQL injection, every single database query utilizes PDO prepared statements. Raw variables are never concatenated into SQL strings.
*   **Standardized JSON Responses:** A central `Response` class wraps all API outputs into a consistent JSON envelope format (`{ "success": bool, "data": array|null, "error": string|null }`), ensuring predictable parsing for the frontend application.
*   **Environment Configuration:** Database credentials are kept secure by loading them from a `.env` file using the `vlucas/phpdotenv` library, ensuring secrets are never hardcoded into the source code or pushed to version control.
