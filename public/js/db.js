/**
 * CampusRoom — Client-Side Database & State Layer
 * Conforms to database_schema_mysql.sql table structures, relationships, and triggers.
 */

(function(window) {
  'use strict';

  const STORAGE_KEYS = {
    USERS: 'campusroom_users',
    ROOMS: 'campusroom_rooms',
    RESERVATIONS: 'campusroom_reservations',
    LOGS: 'campusroom_logs',
    SESSION: 'campusroom_session'
  };

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getStorage(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) {
      console.warn('LocalStorage access error, falling back to default:', e);
      return defaultVal;
    }
  }

  function setStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('LocalStorage write error:', e);
    }
  }

  // --- Seed Data Definition Matching database_schema_mysql.sql ---

  const DEFAULT_USERS = [
    {
      user_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      name: 'Dr. Edgardo Valderama',
      email: 'm.garcia@bpu.edu',
      password_hash: 'password123',
      role: 'Customer',
      department: 'College of Engineering & Technology',
      id_number: 'BPU-2024-88921',
      created_at: '2026-09-01 08:00:00'
    },
    {
      user_id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      name: 'Prof. Sarah Lin (Facilities Officer)',
      email: 'staff@bpu.edu',
      password_hash: 'staff123',
      role: 'Staff',
      department: 'University Administration & Facilities Staff',
      id_number: 'BPU-STAFF-4021',
      created_at: '2026-09-01 08:00:00'
    },
    {
      user_id: 'e9f8d7c6-b5a4-4f3e-2d1c-0b9a8f7e6d5c',
      name: 'ICT Governance Administrator',
      email: 'admin@bpu.edu',
      password_hash: 'admin123',
      role: 'Admin',
      department: 'Central ICT Services',
      id_number: 'BPU-ADMIN-0001',
      created_at: '2026-09-01 08:00:00'
    }
  ];

  const DEFAULT_ROOMS = [
    {
      room_id: 'rm-thn-204',
      code: 'THN-204',
      name: 'Room 204',
      building_name: 'Tech Hall North',
      building: 'tech',
      capacity: 35,
      is_active: 1,
      status: 'Available',
      room_type: 'Tier-2 Lecture & Seminar',
      equipment: ['4K Laser Projector', 'Tiered Wooden Seating', 'AV Lectern', 'High-Speed Wi-Fi'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZr6OKRxRUpi1apuQGApDoT5wqb1GWFtZ17PqQIJqqL-afwi7q4Titls5j6qTw3Bx74sKJ9TCZVsAcuK4zQAR8Zcc5M22v0RepU4SaTrgzsiAXQ1_oFnLvV_IzYVx81QEbkcpXTbcgz3W22PJEr3g5FxmyMkChxHD7foLsg7JWQRUswPWnX674tJCb9YGupGkbqCYRSLFoHD9BoIJLayDZFmMUhw8EFmHzxqiiTQGUqp3QNP58zrLt',
      created_at: '2026-09-01 08:00:00'
    },
    {
      room_id: 'rm-thn-205',
      code: 'THN-205',
      name: 'Room 205',
      building_name: 'Tech Hall North',
      building: 'tech',
      capacity: 40,
      is_active: 1,
      status: 'Available',
      room_type: 'High-Spec Computing Lab',
      equipment: ['Dual Display Terminals', 'Central Audio Console', 'Network Patching Hub'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDm1dFp2IQ-nstXYA4RNY_-b8YXtL1R48WKgbBAWALMZIV6oSrAY9EauYg40kFGJ41sRdnRZI8b58tiBdRdMQEwNe66zndw8ab8sisT46d_weniE3Fu4kXWzpiBM4fmdcGjTfNWRu8IfGJd63VnL-tRawlkb1vFRabIOdTXD91TYA_p-pCpSQERBr_Fv3onVk2dxmSxJPcIn7FIc_knk8ThzQ0yKC7xVQkB0b7n-m1A75oW2LkZd1o7',
      created_at: '2026-09-01 08:00:00'
    },
    {
      room_id: 'rm-scb-102',
      code: 'SCB-102',
      name: 'Room 102',
      building_name: 'Science Complex B',
      building: 'science',
      capacity: 50,
      is_active: 1,
      status: 'Maintenance',
      room_type: 'Chemistry Wet Lab & Demonstration',
      equipment: ['Chemical Fume Hoods', 'Eye Wash Stations', 'Interactive Smartboard'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZr6OKRxRUpi1apuQGApDoT5wqb1GWFtZ17PqQIJqqL-afwi7q4Titls5j6qTw3Bx74sKJ9TCZVsAcuK4zQAR8Zcc5M22v0RepU4SaTrgzsiAXQ1_oFnLvV_IzYVx81QEbkcpXTbcgz3W22PJEr3g5FxmyMkChxHD7foLsg7JWQRUswPWnX674tJCb9YGupGkbqCYRSLFoHD9BoIJLayDZFmMUhw8EFmHzxqiiTQGUqp3QNP58zrLt',
      created_at: '2026-09-01 08:00:00'
    },
    {
      room_id: 'rm-mq-310',
      code: 'MQ-310',
      name: 'Room 310',
      building_name: 'Main Quad',
      building: 'main',
      capacity: 65,
      is_active: 1,
      status: 'Maintenance',
      room_type: 'Multipurpose Auditorium Tier',
      equipment: ['Surround Sound PA', 'Dual Laser Stage Projector', 'Press Recording Suite'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDm1dFp2IQ-nstXYA4RNY_-b8YXtL1R48WKgbBAWALMZIV6oSrAY9EauYg40kFGJ41sRdnRZI8b58tiBdRdMQEwNe66zndw8ab8sisT46d_weniE3Fu4kXWzpiBM4fmdcGjTfNWRu8IfGJd63VnL-tRawlkb1vFRabIOdTXD91TYA_p-pCpSQERBr_Fv3onVk2dxmSxJPcIn7FIc_knk8ThzQ0yKC7xVQkB0b7n-m1A75oW2LkZd1o7',
      created_at: '2026-09-01 08:00:00'
    },
    {
      room_id: 'rm-ew-lab4',
      code: 'EW-LAB4',
      name: 'Engineering Lab 4',
      building_name: 'Engineering Wing',
      building: 'engineering',
      capacity: 25,
      is_active: 1,
      status: 'Available',
      room_type: 'Robotics & Hardware Prototyping',
      equipment: ['3D Printers', 'Oscilloscopes', 'Soldering Stations', 'Fume Extractor'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZr6OKRxRUpi1apuQGApDoT5wqb1GWFtZ17PqQIJqqL-afwi7q4Titls5j6qTw3Bx74sKJ9TCZVsAcuK4zQAR8Zcc5M22v0RepU4SaTrgzsiAXQ1_oFnLvV_IzYVx81QEbkcpXTbcgz3W22PJEr3g5FxmyMkChxHD7foLsg7JWQRUswPWnX674tJCb9YGupGkbqCYRSLFoHD9BoIJLayDZFmMUhw8EFmHzxqiiTQGUqp3QNP58zrLt',
      created_at: '2026-09-01 08:00:00'
    },
    {
      room_id: 'rm-hc-101',
      code: 'HC-101',
      name: 'Room 101',
      building_name: 'Humanities Center',
      building: 'humanities',
      capacity: 30,
      is_active: 1,
      status: 'Available',
      room_type: 'Colloquium & Reading Room',
      equipment: ['Audio Recording Deck', 'Acoustic Wall Panels', 'Lectern'],
      image_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDm1dFp2IQ-nstXYA4RNY_-b8YXtL1R48WKgbBAWALMZIV6oSrAY9EauYg40kFGJ41sRdnRZI8b58tiBdRdMQEwNe66zndw8ab8sisT46d_weniE3Fu4kXWzpiBM4fmdcGjTfNWRu8IfGJd63VnL-tRawlkb1vFRabIOdTXD91TYA_p-pCpSQERBr_Fv3onVk2dxmSxJPcIn7FIc_knk8ThzQ0yKC7xVQkB0b7n-m1A75oW2LkZd1o7',
      created_at: '2026-09-01 08:00:00'
    }
  ];

  const DEFAULT_RESERVATIONS = [
    {
      reservation_id: 'res-bpu-8902',
      code: '#BPU-8902',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Edgardo Valderama',
      room_id: 'rm-thn-204',
      purpose: 'Faculty Thesis Prep & Capstone Defense',
      start_time: '2026-10-25T14:00:00',
      end_time: '2026-10-25T16:00:00',
      status: 'Pending',
      processed_by: null,
      equipment_notes: 'AV Lectern Requested',
      created_at: '2026-10-20 10:15:00'
    },
    {
      reservation_id: 'res-bpu-8903',
      code: '#BPU-8903',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Edgardo Valderama',
      room_id: 'rm-thn-205',
      purpose: 'Advanced Algorithms Lab Practical Exam',
      start_time: '2026-10-28T09:00:00',
      end_time: '2026-10-28T11:30:00',
      status: 'Pending',
      processed_by: null,
      equipment_notes: 'Dual Terminal Setup',
      created_at: '2026-10-21 11:30:00'
    },
    {
      reservation_id: 'res-bpu-8874',
      code: '#BPU-8874',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Edgardo Valderama',
      room_id: 'rm-thn-204',
      purpose: 'Departmental Faculty Council Assembly',
      start_time: '2026-10-26T10:00:00',
      end_time: '2026-10-26T12:00:00',
      status: 'Approved',
      processed_by: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      equipment_notes: 'Standard AV',
      created_at: '2026-10-18 14:22:00'
    },
    {
      reservation_id: 'res-bpu-9102',
      code: '#BPU-9102',
      customer_id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      customer_name: 'Prof. Sarah Lin',
      room_id: 'rm-thn-204',
      purpose: 'BPU Robotics Club Pre-Competition Testing',
      start_time: '2026-10-27T13:00:00',
      end_time: '2026-10-27T15:00:00',
      status: 'Pending',
      processed_by: null,
      equipment_notes: 'Workbench + Fume Extractor',
      created_at: '2026-10-22 09:10:00'
    },
    {
      reservation_id: 'res-bpu-9105',
      code: '#BPU-9105',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Elena Vance',
      room_id: 'rm-thn-205',
      purpose: 'Faculty Peer Review Symposium',
      start_time: '2026-10-29T15:00:00',
      end_time: '2026-10-29T17:00:00',
      status: 'Pending',
      processed_by: null,
      equipment_notes: 'Laser Projector',
      created_at: '2026-10-22 14:00:00'
    },
    {
      reservation_id: 'res-bpu-8840',
      code: '#BPU-8840',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Edgardo Valderama',
      room_id: 'rm-hc-101',
      purpose: 'Guest Lecture: AI in Higher Education Governance',
      start_time: '2026-10-15T14:00:00',
      end_time: '2026-10-15T16:00:00',
      status: 'Completed',
      processed_by: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      equipment_notes: 'Microphone Kit',
      created_at: '2026-10-10 09:00:00'
    },
    {
      reservation_id: 'res-bpu-8799',
      code: '#BPU-8799',
      customer_id: 'd6b7b752-9426-4fa2-bf42-0f5898d098e1',
      customer_name: 'Dr. Edgardo Valderama',
      room_id: 'rm-mq-310',
      purpose: 'Emergency All-Hands Staff Meeting',
      start_time: '2026-10-10T11:00:00',
      end_time: '2026-10-10T12:00:00',
      status: 'Rejected',
      processed_by: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      equipment_notes: 'Room Offline',
      created_at: '2026-10-08 16:45:00'
    }
  ];

  const DEFAULT_LOGS = [
    {
      log_id: 'log-001',
      user_id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      action_type: 'System Dispatch Station Initialized (Terminal 04-A)',
      timestamp: '2026-10-25 14:00:00'
    }
  ];

  // --- Initialize Storage ---
  function initDatabase() {
    if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
      setStorage(STORAGE_KEYS.USERS, DEFAULT_USERS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.ROOMS)) {
      setStorage(STORAGE_KEYS.ROOMS, DEFAULT_ROOMS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.RESERVATIONS)) {
      setStorage(STORAGE_KEYS.RESERVATIONS, DEFAULT_RESERVATIONS);
    }
    if (!localStorage.getItem(STORAGE_KEYS.LOGS)) {
      setStorage(STORAGE_KEYS.LOGS, DEFAULT_LOGS);
    }
    // Default active session to customer if none exists
    if (!localStorage.getItem(STORAGE_KEYS.SESSION)) {
      setStorage(STORAGE_KEYS.SESSION, DEFAULT_USERS[0]);
    }
  }

  initDatabase();

  // --- Database Service API ---

  const DB = {
    // Users API
    getUsers() {
      return getStorage(STORAGE_KEYS.USERS, DEFAULT_USERS);
    },

    findUserByEmail(email) {
      if (!email) return null;
      const users = this.getUsers();
      return users.find(u => u.email.toLowerCase() === email.trim().toLowerCase()) || null;
    },

    createUser(userData) {
      const users = this.getUsers();
      if (this.findUserByEmail(userData.email)) {
        throw new Error('An account with this institutional email already exists.');
      }
      const newUser = {
        user_id: generateUUID(),
        name: userData.name,
        email: userData.email.trim().toLowerCase(),
        password_hash: userData.password,
        role: userData.role || 'Customer',
        department: userData.department || 'Academic Unit',
        id_number: userData.id_number || 'BPU-' + new Date().getFullYear() + '-' + Math.floor(10000 + Math.random() * 90000),
        created_at: new Date().toISOString()
      };
      users.push(newUser);
      setStorage(STORAGE_KEYS.USERS, users);
      this.logAction(newUser.user_id, `User registered: ${newUser.name} (${newUser.email})`);
      return newUser;
    },

    // Session Management
    getCurrentUser() {
      const session = getStorage(STORAGE_KEYS.SESSION, null);
      return session || DEFAULT_USERS[0];
    },

    setCurrentUser(user) {
      setStorage(STORAGE_KEYS.SESSION, user);
      if (user) {
        this.logAction(user.user_id, `User session started: ${user.email}`);
      }
    },

    logout() {
      const user = this.getCurrentUser();
      if (user) {
        this.logAction(user.user_id, `User logged out: ${user.email}`);
      }
      localStorage.removeItem(STORAGE_KEYS.SESSION);
    },

    // Rooms API
    getRooms() {
      return getStorage(STORAGE_KEYS.ROOMS, DEFAULT_ROOMS);
    },

    getRoomById(roomId) {
      const rooms = this.getRooms();
      return rooms.find(r => r.room_id === roomId || r.code === roomId) || null;
    },

    updateRoom(roomId, updates) {
      const rooms = this.getRooms();
      const idx = rooms.findIndex(r => r.room_id === roomId || r.code === roomId);
      if (idx !== -1) {
        rooms[idx] = { ...rooms[idx], ...updates };
        setStorage(STORAGE_KEYS.ROOMS, rooms);
        const currentUser = this.getCurrentUser();
        this.logAction(currentUser ? currentUser.user_id : null, `Room ${rooms[idx].name} updated: status=${rooms[idx].status}`);
        return rooms[idx];
      }
      return null;
    },

    toggleRoomStatus(roomId) {
      const room = this.getRoomById(roomId);
      if (!room) return null;
      const newStatus = room.status === 'Available' ? 'Maintenance' : 'Available';
      return this.updateRoom(room.room_id, { status: newStatus });
    },

    // --- Overlap-Prevention Trigger Emulation ---
    /**
     * Replicates prevent_double_booking_insert and prevent_double_booking_update triggers:
     * Raises: "Scheduling Collision: Room is already booked or pending during this time window."
     */
    checkDoubleBooking(roomId, startTime, endTime, excludeReservationId = null) {
      const newStart = new Date(startTime).getTime();
      const newEnd = new Date(endTime).getTime();

      if (isNaN(newStart) || isNaN(newEnd)) {
        return { hasCollision: true, message: 'Invalid datetime values provided for reservation.' };
      }

      if (newEnd <= newStart) {
        return { hasCollision: true, message: 'Invalid schedule: End time must be strictly after Start time.' };
      }

      const reservations = this.getReservations();

      const conflicting = reservations.find(res => {
        if (res.room_id !== roomId) return false;
        if (excludeReservationId && (res.reservation_id === excludeReservationId || res.code === excludeReservationId)) return false;
        if (!['Pending', 'Approved'].includes(res.status)) return false;

        const resStart = new Date(res.start_time).getTime();
        const resEnd = new Date(res.end_time).getTime();

        // Overlap conditions from SQL triggers:
        // (NEW.start_time >= start_time AND NEW.start_time < end_time) OR
        // (NEW.end_time   >  start_time AND NEW.end_time  <= end_time) OR
        // (NEW.start_time <= start_time AND NEW.end_time  >= end_time)
        const condition1 = (newStart >= resStart && newStart < resEnd);
        const condition2 = (newEnd > resStart && newEnd <= resEnd);
        const condition3 = (newStart <= resStart && newEnd >= resEnd);

        return condition1 || condition2 || condition3;
      });

      if (conflicting) {
        return {
          hasCollision: true,
          message: 'Scheduling Collision: Room is already booked or pending during this time window.',
          conflictingReservation: conflicting
        };
      }

      return { hasCollision: false };
    },

    // Reservations API
    getReservations(filterCustomerId = null) {
      const all = getStorage(STORAGE_KEYS.RESERVATIONS, DEFAULT_RESERVATIONS);
      if (filterCustomerId) {
        return all.filter(r => r.customer_id === filterCustomerId);
      }
      return all;
    },

    getReservationById(resId) {
      const all = this.getReservations();
      return all.find(r => r.reservation_id === resId || r.code === resId) || null;
    },

    createReservation(data) {
      // 1. Enforce Concurrency / Overlap Trigger
      const check = this.checkDoubleBooking(data.room_id, data.start_time, data.end_time);
      if (check.hasCollision) {
        const err = new Error(check.message);
        err.isCollision = true;
        throw err;
      }

      const currentUser = this.getCurrentUser();
      const newReservationId = generateUUID();
      const codeNumber = Math.floor(1000 + Math.random() * 9000);
      const newCode = `#BPU-${codeNumber}`;

      const newRecord = {
        reservation_id: newReservationId,
        code: newCode,
        customer_id: currentUser ? currentUser.user_id : 'guest',
        customer_name: currentUser ? currentUser.name : (data.customer_name || 'Faculty Member'),
        room_id: data.room_id,
        purpose: data.purpose,
        start_time: data.start_time,
        end_time: data.end_time,
        status: 'Pending',
        processed_by: null,
        equipment_notes: data.equipment_notes || 'Standard Setup',
        created_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      };

      const reservations = this.getReservations();
      reservations.unshift(newRecord);
      setStorage(STORAGE_KEYS.RESERVATIONS, reservations);

      this.logAction(
        currentUser ? currentUser.user_id : null,
        `Reservation requested: ${newCode} for Room ${data.room_id} (${data.purpose})`
      );

      return newRecord;
    },

    updateReservationStatus(resId, newStatus, processedBy = null) {
      const reservations = this.getReservations();
      const idx = reservations.findIndex(r => r.reservation_id === resId || r.code === resId);
      if (idx !== -1) {
        reservations[idx].status = newStatus;
        if (processedBy) {
          reservations[idx].processed_by = processedBy;
        }
        setStorage(STORAGE_KEYS.RESERVATIONS, reservations);

        const staff = this.getCurrentUser();
        this.logAction(
          staff ? staff.user_id : null,
          `Reservation ${reservations[idx].code} marked as ${newStatus}`
        );
        return reservations[idx];
      }
      return null;
    },

    cancelReservation(resId) {
      return this.updateReservationStatus(resId, 'Rejected');
    },

    // System Logs API
    getSystemLogs() {
      return getStorage(STORAGE_KEYS.LOGS, DEFAULT_LOGS);
    },

    logAction(userId, actionType) {
      const logs = this.getSystemLogs();
      const newLog = {
        log_id: generateUUID(),
        user_id: userId,
        action_type: actionType,
        timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19)
      };
      logs.unshift(newLog);
      // Keep recent 100 logs
      if (logs.length > 100) logs.pop();
      setStorage(STORAGE_KEYS.LOGS, logs);
      return newLog;
    },

    resetDatabase() {
      localStorage.removeItem(STORAGE_KEYS.USERS);
      localStorage.removeItem(STORAGE_KEYS.ROOMS);
      localStorage.removeItem(STORAGE_KEYS.RESERVATIONS);
      localStorage.removeItem(STORAGE_KEYS.LOGS);
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      initDatabase();
    }
  };

  window.CampusRoomDB = DB;

})(window);
