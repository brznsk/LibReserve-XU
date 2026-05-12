/** Local calendar date YYYY-MM-DD */
function reservationTodayLocal() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/** Local time HH:MM (24h) */
function reservationNowTimeLocal() {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
  );
}

function reservationTimeToMinutes(t) {
  const parts = String(t).trim().split(":");
  if (parts.length < 2) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

/** True if [aStart, aEnd) overlaps [bStart, bEnd) — adjacent slots (end === other start) do not overlap */
function reservationSlotsOverlap(aStart, aEnd, bStart, bEnd) {
  const as = reservationTimeToMinutes(aStart);
  const ae = reservationTimeToMinutes(aEnd);
  const bs = reservationTimeToMinutes(bStart);
  const be = reservationTimeToMinutes(bEnd);
  if ([as, ae, bs, be].some((x) => Number.isNaN(x))) return false;
  return as < be && bs < ae;
}

function reservationSameRoom(a, b) {
  if (a.roomNum != null && b.roomNum != null) return Number(a.roomNum) === Number(b.roomNum);
  return String(a.roomName || "") === String(b.roomName || "");
}

/**
 * Conflicts with an existing approved booking (for staff approval checks).
 * @param {string|null|undefined} excludeId - reservation id to skip (the one being approved)
 */
function findApprovedBookingConflict(candidate, list, excludeId) {
  for (let i = 0; i < list.length; i++) {
    const other = list[i];
    if (excludeId != null && other.id === excludeId) continue;
    if (other.status !== "approved") continue;
    if (!reservationSameRoom(candidate, other)) continue;
    if (String(other.date) !== String(candidate.date)) continue;
    if (
      reservationSlotsOverlap(
        candidate.startTime,
        candidate.endTime,
        other.startTime,
        other.endTime
      )
    ) {
      return other;
    }
  }
  return null;
}

/**
 * Blocks new student requests only if an approved booking already uses this room and time.
 * Pending requests do not block new submissions (staff resolves overlaps when approving).
 */
function findStudentBookingConflict(candidate, list) {
  for (let i = 0; i < list.length; i++) {
    const other = list[i];
    if (other.status !== "approved") continue;
    if (!reservationSameRoom(candidate, other)) continue;
    if (String(other.date) !== String(candidate.date)) continue;
    if (
      reservationSlotsOverlap(
        candidate.startTime,
        candidate.endTime,
        other.startTime,
        other.endTime
      )
    ) {
      return other;
    }
  }
  return null;
}

/**
 * After a request is approved, reject other pending requests for the same room/date/time overlap.
 * Sets rejectReason so students see it on Track status.
 */
function autoRejectPendingConflictsAfterApproval(list, approvedRow, reviewedByEmail) {
  const nowIso = new Date().toISOString();
  const by = reviewedByEmail || "staff";
  let count = 0;
  const bumpedIds = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.id === approvedRow.id) continue;
    if (r.status !== "pending") continue;
    if (!reservationSameRoom(r, approvedRow)) continue;
    if (String(r.date) !== String(approvedRow.date)) continue;
    if (
      !reservationSlotsOverlap(
        r.startTime,
        r.endTime,
        approvedRow.startTime,
        approvedRow.endTime
      )
    ) {
      continue;
    }
    r.status = "rejected";
    r.reviewedAt = nowIso;
    r.reviewedBy = by;
    r.rejectReason =
      "Another reservation was approved for this room and time. Try a different time or room. (Approved booking: " +
      approvedRow.id +
      ")";
    bumpedIds.push(r.id);
    count++;
  }
  return { count, bumpedIds };
}

/** Milliseconds before start time by which a student may still cancel (local date + time). */
const RESERVATION_STUDENT_CANCEL_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * Start of the reservation slot in local time.
 * @returns {number} epoch ms, or NaN if invalid
 */
function reservationLocalStartMs(dateStr, startTime) {
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return NaN;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const tm = reservationTimeToMinutes(startTime);
  if ([y, mo, d].some((n) => Number.isNaN(n)) || Number.isNaN(tm)) return NaN;
  const dt = new Date(y, mo - 1, d, Math.floor(tm / 60), tm % 60, 0, 0);
  return dt.getTime();
}

/**
 * @param {{ status?: string, date?: string, startTime?: string }} r
 * @returns {string|null} Error message if the student may not cancel; null if cancellation is allowed.
 */
function reservationStudentCancelBlockReason(r) {
  if (!r) return "Reservation not found.";
  if (r.status !== "pending" && r.status !== "approved") {
    return "Only pending or approved reservations can be cancelled.";
  }
  const startMs = reservationLocalStartMs(r.date, r.startTime);
  if (Number.isNaN(startMs)) {
    return "This reservation has an invalid date or time.";
  }
  const deadline = startMs - RESERVATION_STUDENT_CANCEL_LEAD_MS;
  if (Date.now() > deadline) {
    return "You can only cancel at least 2 hours before the start time.";
  }
  return null;
}

function reservationValidateNotPast(dateStr, startTime, endTime) {
  const today = reservationTodayLocal();
  if (dateStr < today) {
    return "You cannot reserve a date in the past.";
  }
  if (dateStr === today) {
    const nowT = reservationNowTimeLocal();
    if (endTime <= nowT) {
      return "This time slot has already ended today.";
    }
    if (startTime < nowT) {
      return "For today, choose a start time that is not in the past.";
    }
  }
  return null;
}

/** 0 = Sunday … 6 = Saturday (local calendar date from YYYY-MM-DD) */
function reservationLocalDayOfWeek(dateStr) {
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return NaN;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if ([y, mo, d].some((n) => Number.isNaN(n))) return NaN;
  return new Date(y, mo - 1, d).getDay();
}

/**
 * XU Libraries: Mon–Fri 8:00–20:00, Sat 8:00–17:00, closed Sundays (main + School of Medicine library).
 * @returns {{ closed: true } | { open: string, close: string } | null}
 */
function reservationLibraryHoursWindow(dateStr) {
  const dow = reservationLocalDayOfWeek(dateStr);
  if (Number.isNaN(dow)) return null;
  if (dow === 0) return { closed: true };
  const close = dow === 6 ? "17:00" : "20:00";
  return { open: "08:00", close };
}

/** @returns {string|null} Error message or null if within library hours */
function reservationValidateLibraryHours(dateStr, startTime, endTime) {
  const win = reservationLibraryHoursWindow(dateStr);
  if (!win) return "Invalid date.";
  if (win.closed) {
    return "XU Libraries are closed on Sundays. Choose Monday through Saturday.";
  }
  const s = reservationTimeToMinutes(startTime);
  const e = reservationTimeToMinutes(endTime);
  const o = reservationTimeToMinutes(win.open);
  const c = reservationTimeToMinutes(win.close);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  if (s < o || e > c) {
    const dow = reservationLocalDayOfWeek(dateStr);
    const closeLabel = dow === 6 ? "5:00 PM" : "8:00 PM";
    return (
      "Reservations must fall within library hours: 8:00 AM – " +
      closeLabel +
      " on this day (Mon–Fri until 8:00 PM, Saturday until 5:00 PM)."
    );
  }
  return null;
}
