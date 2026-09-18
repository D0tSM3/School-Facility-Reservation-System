# Phase 3 – Required Student Submission: CampusRoom

## 1. Project Overview & Requirements Met

| Requirement | How We Met It |
|-------------|---------------|
| **1. Responsive Interface** | The entire CampusRoom facility gateway is built with responsive Tailwind CSS utilities, adapting properly to desktop, tablet, and mobile views. |
| **2. JavaScript Functionality** | We have comprehensive JS files (`app.js`, `rooms.js`, `reservations.js`, `booking.js`) demonstrating interactive modals, dynamic room rendering, pagination, and role-based navigation. |
| **3. API Integration** | The frontend acts as a Single Page Application (SPA)-style interface that communicates with our custom PHP backend REST API endpoints to fetch rooms, reservations, and submit bookings. |
| **4. AJAX / Fetch** | All data retrieval, form submissions, and status updates (like cancelling a reservation or approving a booking) are done via JavaScript `fetch()` without reloading the page. |
| **5. Form Validation** | Booking forms prevent scheduling errors (like end-time before start-time), check for required fields, and show dynamic error banners before submission. |
| **6. Search / Filter** | The Rooms page and Reservations page both feature dynamic search bars and multi-select filters (e.g., filtering by Floor, Room Type, or Status) that update the UI instantly. |

## 2. API Documentation / Notes

- **API Used**: CampusRoom Internal REST API (Custom PHP Backend)
- **API Purpose**: To handle authentication, serve facility/room data, and manage reservation creation/approval securely.
- **API Endpoint(s)**:
  - `GET /api/rooms` - Fetches all reservable rooms.
  - `GET /api/reservations/mine` - Retrieves bookings for the logged-in user.
  - `POST /api/reservations/book` - Submits a new room reservation.
  - `PATCH /api/reservations/{id}/cancel` - Cancels a pending reservation.
- **Data retrieved from the API**: JSON payloads containing arrays of room objects (id, name, floor, type, capacity, status) and reservation objects (schedule, purpose, status).
- **How the API is integrated into the website**: The frontend uses native `fetch()` calls in JavaScript files (e.g., `rooms.js`). Responses are parsed as JSON, and DOM elements are dynamically created to render the grid of rooms and tables of reservations.

## 3. Screenshots

*(Placeholder: Insert images here showing the major features below)*

### Desktop and Mobile Views
![Desktop & Mobile Views Placeholder](path/to/screenshot_responsive.png)

### API-Generated Content (Room Grid)
![API Rooms Placeholder](path/to/screenshot_api_rooms.png)

### Form Validation / Error Messages
![Form Validation Placeholder](path/to/screenshot_validation.png)

### Search / Filter Results
![Search Filter Placeholder](path/to/screenshot_search_filter.png)

## 4. Members Ratings and Contribution

*(To be filled by Leader / Asst Leader)*

| Team Member Name | Role / Responsibility | Contribution Details | Peer Rating (1-10) |
|------------------|-----------------------|----------------------|--------------------|
| **[Name 1]**     | Project Manager       | Managed timeline, requirements, and team tasks. | [ / 10] |
| **[Name 2]**     | Frontend Developer    | Built the UI, responsive design, and JS interactivity. | [ / 10] |
| **[Name 3]**     | Backend Developer     | Created the API endpoints and routing logic. | [ / 10] |
| **[Name 4]**     | Database Manager      | Designed the schema, wrote queries, and seeded data. | [ / 10] |
| **[Name 5]**     | Security Checker      | Handled authentication, input sanitization, and OTP logic. | [ / 10] |

## 5. Suggested Submission Checklist

- [ ] Responsive interface works on different screen sizes
- [ ] JavaScript features are functional
- [ ] API is successfully connected
- [ ] AJAX/Fetch is implemented
- [ ] Form validation works correctly
- [ ] Search/filter works correctly
- [ ] All pages and navigation links work
- [ ] No broken images or missing files
- [ ] Project folder is complete and organized
- [ ] API documentation is included
- [ ] Screenshots are included
- [ ] Project is ready for presentation/checking
