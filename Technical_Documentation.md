# CampusRoom: Technical Documentation

## 1. Project Overview
CampusRoom is a web-based facility reservation system for Buenavista Polytechnic University (BPU). It is designed to streamline the booking of instructional spaces, labs, and equipment. The system features role-based access control (RBAC) ensuring that Customers (Students/Faculty), Staff, and Administrators have customized workflows for managing facility usage securely and efficiently.

## 2. Team Contributions

| Team Member Name | Role / Responsibility | Key Contributions |
|------------------|-----------------------|-------------------|
| **[Member 1 Name]** | **Project Manager** | Oversaw project timeline, coordinated tasks, ensured alignment with requirements, and managed team communication. |
| **[Member 2 Name]** | **Frontend Developer** | Designed and implemented the UI using HTML/CSS/JS, integrated responsive layouts, pagination, and dynamic views. |
| **[Member 3 Name]** | **Backend Developer** | Developed the PHP backend, created the RESTful API endpoints, handled routing, and integrated business logic. |
| **[Member 4 Name]** | **Database Manager** | Designed the MySQL database schema, wrote SQL queries/triggers, and managed data seeding and CSV imports. |
| **[Member 5 Name]** | **Security Checker** | Implemented password hashing, managed OTP email verification logic, secured API endpoints, and sanitized inputs. |

## 3. System Architecture
The application follows a standard Client-Server architecture designed for high performance and low overhead:
- **Frontend**: Vanilla JavaScript, HTML5, and CSS (Tailwind tokens).
- **Backend**: PHP (Custom lightweight MVC-style framework).
- **Database**: MySQL.

## 4. Key Features & Screenshots

### 4.1. Authentication & OTP Verification
Secure login system requiring an email and password, followed by a One-Time Password (OTP) verification sent via email.
![Login Screen Placeholder](path/to/screenshot_login.png)
*(Placeholder: Insert screenshot of the Login and OTP screens here)*

### 4.2. Dashboard & User Roles
Role-specific dashboards providing customized metrics and quick actions for Customers (My Reservations), Staff (Staff Queue), and Admin (Admin Governance).
![Dashboard Placeholder](path/to/screenshot_dashboard.png)
*(Placeholder: Insert screenshot of the Dashboard here)*

### 4.3. Room Browsing & Pagination
Users can browse available spaces, filter by floor/room type, and see real-time availability. The grid is dynamically paginated for performance.
![Rooms Placeholder](path/to/screenshot_rooms.png)
*(Placeholder: Insert screenshot of the paginated Rooms page here)*

### 4.4. Facility Reservation
A seamless booking process that prevents overlapping reservations using MySQL database triggers and backend time validation.
![Booking Form Placeholder](path/to/screenshot_booking.png)
*(Placeholder: Insert screenshot of the Booking form here)*

### 4.5. Reservation Management
Users can track their bookings and instantly cancel pending requests. Staff can review, approve, or reject requests from a centralized queue.
![Management Placeholder](path/to/screenshot_management.png)
*(Placeholder: Insert screenshot of the Reservations/Staff Queue page here)*

## 5. Database Schema Highlights
- **`Users`**: Stores credentials, roles (`admin`, `staff`, `customer`), and verification data.
- **`Rooms`**: Contains facility details, capacities, floor numbers, and room types.
- **`Reservations`**: Tracks bookings, start/end times, and status (`Pending`, `Approved`, `Rejected`, `Cancelled`, `Completed`).

![ER Diagram Placeholder](path/to/screenshot_er_diagram.png)
*(Placeholder: Insert an Entity-Relationship (ER) Diagram here)*

---
*Document prepared for project submission. Please replace all bracketed names and placeholder image paths before finalizing.*
