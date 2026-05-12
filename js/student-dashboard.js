/** Fallback if `/rooms` API is unavailable */
const FALLBACK_ROOMS = [
  { n: 1, loc: "New Building · 5th floor", cap: 15, internet: "School Wi‑Fi", whiteboard: false, projector: true },
  { n: 2, loc: "New Building · 5th floor", cap: 15, internet: "School Wi‑Fi", whiteboard: false, projector: true },
  { n: 3, loc: "New Building · 4th floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { n: 4, loc: "New Building · 4th floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { n: 5, loc: "New Building · 3rd floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { n: 6, loc: "New Building · 3rd floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
];

/** Loaded from MongoDB via API (same shape as before). */
let rooms = [];
/** @type {Array<object>} */
let reservationsCache = [];

let session = null;
let selectedRoom = null;

async function loadStudentBookingData() {
  try {
    rooms = await fetchRoomsFromApi();
  } catch (e) {
    console.warn("Using default room list (rooms API failed)", e);
    rooms = FALLBACK_ROOMS.slice();
  }
  try {
    reservationsCache = await fetchReservationsFromApi();
  } catch (e) {
    console.error(e);
    reservationsCache = [];
  }
}

/** Weekly schedule modal: which room and week offset from current (0 = this week) */
let scheduleRoomViewing = null;
let scheduleViewWeekOffset = 0;

const SCHEDULE_CAL_START_MIN = 8 * 60;
const SCHEDULE_CAL_END_MIN = 20 * 60;
const SCHEDULE_HOUR_PX = 44;
const SCHEDULE_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatYMDFromDate(d) {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function getMondayOfDate(base) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatHourLabel(h24) {
  const am = h24 < 12;
  const h12 = h24 % 12 || 12;
  return h12 + (am ? " AM" : " PM");
}

function formatTimeRangeLabel(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const sAm = sh < 12;
  const eAm = eh < 12;
  const sh12 = sh % 12 || 12;
  const eh12 = eh % 12 || 12;
  const s = sh12 + ":" + pad2(sm) + (sAm ? " AM" : " PM");
  const e = eh12 + ":" + pad2(em) + (eAm ? " AM" : " PM");
  return s + " – " + e;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scheduleEventBlockStyle(dateStr, startTime, endTime) {
  const win = reservationLibraryHoursWindow(dateStr);
  if (!win || win.closed) return null;
  const dayOpen = reservationTimeToMinutes(win.open);
  const dayClose = reservationTimeToMinutes(win.close);
  let s = reservationTimeToMinutes(startTime);
  let e = reservationTimeToMinutes(endTime);
  if ([s, e].some((x) => Number.isNaN(x))) return null;
  s = Math.max(s, dayOpen, SCHEDULE_CAL_START_MIN);
  e = Math.min(e, dayClose, SCHEDULE_CAL_END_MIN);
  if (e <= s) return null;
  const span = SCHEDULE_CAL_END_MIN - SCHEDULE_CAL_START_MIN;
  const top = ((s - SCHEDULE_CAL_START_MIN) / span) * 100;
  const h = ((e - s) / span) * 100;
  return { top: top + "%", height: h + "%" };
}

function closedHoursOverlayTop(dateStr) {
  const win = reservationLibraryHoursWindow(dateStr);
  if (!win || win.closed) return null;
  const closeMin = reservationTimeToMinutes(win.close);
  if (closeMin >= SCHEDULE_CAL_END_MIN) return null;
  const span = SCHEDULE_CAL_END_MIN - SCHEDULE_CAL_START_MIN;
  const topPct = ((closeMin - SCHEDULE_CAL_START_MIN) / span) * 100;
  return topPct + "%";
}

/** Leading "1. ", "2. ", … on each line of the group members field */
const MEMBER_LINE_PREFIX = /^\s*\d+\.\s*/;

function stripMemberLineBodies(text) {
  /* Do not trim trailing spaces — a space after the last typed character is still "trailing"
     until the next keypress; trimming was eating Space and blocking normal typing. */
  return text.split("\n").map((line) => line.replace(MEMBER_LINE_PREFIX, ""));
}

function formatMemberLines(bodies) {
  return bodies.map((b, i) => (b === "" ? `${i + 1}. ` : `${i + 1}. ${b}`)).join("\n");
}

function renumberGroupMembersField(el) {
  const oldVal = el.value;
  const oldStart = el.selectionStart;
  const oldEnd = el.selectionEnd;
  const anchor = Math.min(oldStart, oldEnd);

  const bodies = stripMemberLineBodies(oldVal);
  const hasAnyBody = bodies.some((b) => b.trim().length > 0);
  if (!hasAnyBody) {
    if (el.value !== "") {
      el.value = "";
      el.setSelectionRange(0, 0);
    }
    return;
  }

  const before = oldVal.slice(0, anchor);
  const lineIdx = (before.match(/\n/g) || []).length;
  const lineStart = oldVal.lastIndexOf("\n", anchor - 1) + 1;
  const nextNl = oldVal.indexOf("\n", anchor);
  const lineEnd = nextNl === -1 ? oldVal.length : nextNl;
  const lineText = oldVal.slice(lineStart, lineEnd);
  const pref = lineText.match(MEMBER_LINE_PREFIX);
  const prefixLen = pref ? pref[0].length : 0;
  const bodyOffset = Math.max(0, anchor - lineStart - prefixLen);

  const newVal = formatMemberLines(bodies);
  if (newVal === oldVal) return;

  el.value = newVal;

  const newLines = newVal.split("\n");
  let pos = 0;
  for (let i = 0; i < lineIdx; i++) pos += (newLines[i] || "").length + 1;
  const curLine = newLines[lineIdx] || "";
  const newPref = curLine.match(MEMBER_LINE_PREFIX);
  const newPrefLen = newPref ? newPref[0].length : 0;
  const bodyLen = Math.max(0, curLine.length - newPrefLen);
  const newOffset = Math.min(bodyOffset, bodyLen);
  const newPos = pos + newPrefLen + newOffset;
  el.setSelectionRange(newPos, newPos);
}

function groupMembersHasNames(val) {
  return val.split("\n").some((line) => {
    const body = line.replace(MEMBER_LINE_PREFIX, "").trim();
    return body.length > 0;
  });
}

function bindGroupMembersListField() {
  const ta = document.getElementById("m-members");
  if (!ta) return;
  ta.addEventListener("input", () => renumberGroupMembersField(ta));
}

const BOOKING_LIBRARY_HOURS_DEFAULT =
  "XU Libraries: Mon–Fri 8:00 AM–8:00 PM, Sat 8:00 AM–5:00 PM. Closed Sundays.\nYou can only reserve during these hours.";

function syncBookingModalTimeBounds() {
  const dateStr = document.getElementById("m-date").value;
  const startEl = document.getElementById("m-start");
  const endEl = document.getElementById("m-end");
  const hint = document.getElementById("booking-library-hours-hint");
  if (!startEl || !endEl) return;

  if (!dateStr) {
    startEl.removeAttribute("min");
    startEl.removeAttribute("max");
    endEl.removeAttribute("min");
    endEl.removeAttribute("max");
    if (hint) hint.textContent = BOOKING_LIBRARY_HOURS_DEFAULT;
    return;
  }

  const win = reservationLibraryHoursWindow(dateStr);
  if (!win || win.closed) {
    startEl.removeAttribute("min");
    startEl.removeAttribute("max");
    endEl.removeAttribute("min");
    endEl.removeAttribute("max");
    if (hint) hint.textContent = "Library is closed on Sundays. Choose Monday through Saturday.";
    return;
  }

  startEl.min = win.open;
  startEl.max = win.close;
  endEl.min = win.open;
  endEl.max = win.close;
  const dow = reservationLocalDayOfWeek(dateStr);
  if (hint) {
    hint.textContent =
      dow === 6
        ? "This day is Saturday: reserve between 8:00 AM and 5:00 PM only."
        : "This day is Monday–Friday: reserve between 8:00 AM and 8:00 PM only.";
  }
}

function bindBookingModalLibraryHours() {
  const dateEl = document.getElementById("m-date");
  if (!dateEl) return;
  dateEl.addEventListener("change", syncBookingModalTimeBounds);
  dateEl.addEventListener("input", syncBookingModalTimeBounds);
}

(async function studentInit() {
  try {
    session = JSON.parse(sessionStorage.getItem("xu_session") || "null");
  } catch (e) {
    session = null;
  }
  if (!session || !session.email) {
    window.location.href = "LogIn.html";
    return;
  }
  const users = await getUsers();
  const live = users.find((u) => u.email.toLowerCase() === session.email.toLowerCase());
  if (!live || live.accountStatus !== "active") {
    sessionStorage.removeItem("xu_session");
    window.location.href = "LogIn.html";
    return;
  }

  const mayUseDesk =
    live.type === "admin" ||
    live.type === "staff" ||
    (live.type === "student" && live.staffPortalAccess);
  if (session.type === "staff") {
    if (mayUseDesk) {
      window.location.href = "StaffDashBoard.html";
      return;
    }
    sessionStorage.removeItem("xu_session");
    window.location.href = "LogIn.html";
    return;
  }

  const staffBookingOnly = live.type === "staff" && session.type === "student";

  if (live.type === "admin") {
    window.location.href = "AdminDashBoard.html";
    return;
  }
  if (live.type === "staff" && !staffBookingOnly) {
    window.location.href = "StaffDashBoard.html";
    return;
  }
  if (live.type !== "student" && !staffBookingOnly) {
    sessionStorage.removeItem("xu_session");
    window.location.href = "LogIn.html";
    return;
  }

  session.fname = live.fname;
  session.lname = live.lname;
  session.staffPortalAccess = !!live.staffPortalAccess;
  if (!session.loginRole) session.loginRole = staffBookingOnly ? "staff" : "student";
  sessionStorage.setItem("xu_session", JSON.stringify(session));

  const hint = document.getElementById("staff-student-hint");
  if (hint) {
    hint.hidden = !staffBookingOnly;
  }

  const initials = ((session.fname || "S")[0] + (session.lname || "T")[0]).toUpperCase();
  document.getElementById("user-avatar").textContent = initials;
  document.getElementById("user-name").textContent =
    (session.fname || "") + " " + (session.lname || "");
  await loadStudentBookingData();
  renderRooms();
  renderMyReservations();
  bindGroupMembersListField();
  bindBookingModalLibraryHours();
  bindScheduleModal();
  syncBookingModalTimeBounds();
})();

function openScheduleModal(roomNum) {
  scheduleRoomViewing = roomNum;
  scheduleViewWeekOffset = 0;
  document.getElementById("schedule-modal").classList.add("open");
  renderScheduleWeek();
}

function closeScheduleModal() {
  document.getElementById("schedule-modal").classList.remove("open");
}

function bindScheduleModal() {
  const prev = document.getElementById("schedule-prev-week");
  const next = document.getElementById("schedule-next-week");
  const today = document.getElementById("schedule-this-week");
  const overlay = document.getElementById("schedule-modal");
  if (prev)
    prev.addEventListener("click", () => {
      scheduleViewWeekOffset--;
      renderScheduleWeek();
    });
  if (next)
    next.addEventListener("click", () => {
      scheduleViewWeekOffset++;
      renderScheduleWeek();
    });
  if (today)
    today.addEventListener("click", () => {
      scheduleViewWeekOffset = 0;
      renderScheduleWeek();
    });
  if (overlay)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeScheduleModal();
    });
}

function renderScheduleWeek() {
  const root = document.getElementById("schedule-cal-root");
  const titleEl = document.getElementById("schedule-modal-title");
  const labelEl = document.getElementById("schedule-week-label");
  if (!root || scheduleRoomViewing == null) return;

  const room = rooms.find((r) => r.n === scheduleRoomViewing);
  titleEl.textContent =
    "Confab " + scheduleRoomViewing + " — weekly schedule · " + (room ? room.loc : "");

  const monday = getMondayOfDate(new Date());
  monday.setDate(monday.getDate() + scheduleViewWeekOffset * 7);
  const sun = new Date(monday);
  sun.setDate(monday.getDate() + 6);
  labelEl.textContent =
    monday.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " – " +
    sun.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(formatYMDFromDate(d));
  }

  const all = reservationsCache;
  const approved = all.filter(
    (r) =>
      r.status === "approved" &&
      Number(r.roomNum) === Number(scheduleRoomViewing) &&
      dates.includes(String(r.date))
  );

  const bodyHeight = ((SCHEDULE_CAL_END_MIN - SCHEDULE_CAL_START_MIN) / 60) * SCHEDULE_HOUR_PX;

  let gutterLabels = "";
  for (let h = 8; h <= 19; h++) {
    gutterLabels +=
      '<div class="schedule-hour-cell" style="height:' +
      SCHEDULE_HOUR_PX +
      'px">' +
      formatHourLabel(h) +
      "</div>";
  }
  /* Last tick is 8 PM (weekday close); labels 8–19 are hour *starts*, so 7 PM row is 7–8 block */
  const gutterHtml =
    '<div class="schedule-gutter-col" style="min-height:' +
    bodyHeight +
    'px"><div class="schedule-gutter-labels">' +
    gutterLabels +
    '</div><span class="schedule-gutter-end-label">' +
    formatHourLabel(20) +
    "</span></div>";

  let headersHtml = "";
  let columnsHtml = "";
  const todayYmd = formatYMDFromDate(new Date());

  for (let i = 0; i < 7; i++) {
    const dateStr = dates[i];
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const win = reservationLibraryHoursWindow(dateStr);
    const closedAll = win && win.closed;
    const isToday = todayYmd === dateStr;

    headersHtml +=
      '<div class="schedule-day-head' +
      (closedAll ? " schedule-day-head--closed" : "") +
      (isToday ? " schedule-day-head--today" : "") +
      '"><span class="schedule-dow">' +
      SCHEDULE_DAY_LABELS[i] +
      '</span><span class="schedule-dom">' +
      d.getDate() +
      "</span></div>";

    const dayEvents = approved
      .filter((r) => String(r.date) === dateStr)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    let blocksHtml = "";
    for (const r of dayEvents) {
      const st = scheduleEventBlockStyle(dateStr, r.startTime, r.endTime);
      if (!st) continue;
      const rangeLabel = formatTimeRangeLabel(r.startTime, r.endTime);
      blocksHtml +=
        '<div class="schedule-block" style="top:' +
        st.top +
        ";height:" +
        st.height +
        '" title="This time is occupied"><span class="schedule-block-time">' +
        rangeLabel +
        '</span><span class="schedule-block-title">Occupied</span></div>';
    }

    const shadeTop = closedHoursOverlayTop(dateStr);
    const shadeHtml = closedAll
      ? '<div class="schedule-closed-layer schedule-closed-layer--full" aria-hidden="true"><span>Closed</span></div>'
      : shadeTop
        ? '<div class="schedule-closed-layer" style="top:' + shadeTop + '" aria-hidden="true"></div>'
        : "";

    columnsHtml +=
      '<div class="schedule-day-col' +
      (closedAll ? " schedule-day-col--closed" : "") +
      '"><div class="schedule-day-body" style="height:' +
      bodyHeight +
      'px">' +
      shadeHtml +
      blocksHtml +
      "</div></div>";
  }

  root.innerHTML =
    '<div class="schedule-cal-row schedule-cal-row--head">' +
    '<div class="schedule-gutter-corner"></div>' +
    '<div class="schedule-headers-row">' +
    headersHtml +
    "</div></div>" +
    '<div class="schedule-cal-row schedule-cal-row--body">' +
    gutterHtml +
    '<div class="schedule-days-row">' +
    columnsHtml +
    "</div></div>";
}

function renderRooms() {
  const grid = document.getElementById("rooms-grid");
  if (!grid) return;
  if (!rooms.length) {
    grid.innerHTML =
      '<p style="color:var(--text-soft);padding:2rem">No rooms loaded. Check the server and try refreshing.</p>';
    return;
  }
  grid.innerHTML = rooms
    .map((r) => {
      const wb = r.whiteboard
        ? '<span class="spec-val spec-val--on">Available</span>'
        : '<span class="spec-val spec-val--off">Not in room</span>';
      const proj = r.projector
        ? '<span class="spec-val spec-val--on">Available</span>'
        : '<span class="spec-val spec-val--off">Not equipped</span>';
      return `
    <article class="room-card">
      <div class="room-card-header">
        <div class="room-title-block">
          <h2 class="room-num">Confab ${r.n}</h2>
          <p class="room-loc">${r.loc}</p>
        </div>
        <span class="room-badge">Open</span>
      </div>
      <div class="room-body">
        <div class="room-cap-banner">
          <span class="room-cap-value">${r.cap}</span>
          <span class="room-cap-unit">seats</span>
          <span class="room-cap-note">Discussion-table layout</span>
        </div>
        <h3 class="room-section-title">Facilities &amp; connectivity</h3>
        <dl class="room-spec-list">
          <div class="room-spec-row">
            <dt>Internet</dt>
            <dd>${r.internet}</dd>
          </div>
          <div class="room-spec-row">
            <dt>Projector</dt>
            <dd>${proj}</dd>
          </div>
          <div class="room-spec-row">
            <dt>Whiteboard</dt>
            <dd>${wb}</dd>
          </div>
        </dl>
        <p class="room-inventory-note">No fixed PCs, DVD players, or built-in sound systems in these rooms.</p>
        <div class="room-card-actions">
          <button type="button" class="btn-schedule" onclick="openScheduleModal(${r.n})">Weekly schedule</button>
          <button type="button" class="btn-book" onclick="openModal(${r.n})">Request this room</button>
        </div>
      </div>
    </article>
  `;
    })
    .join("");
}

function switchTab(name, el) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  ["rooms", "my-reservations", "track"].forEach((t) => {
    document.getElementById("tab-" + t).style.display = t === name ? "block" : "none";
  });
  if (name === "my-reservations") renderMyReservations();
}

function openModal(roomNum) {
  selectedRoom = rooms.find((r) => r.n === roomNum);
  document.getElementById("selected-room-label").textContent =
    "Confab " + roomNum + " — " + selectedRoom.loc;
  document.getElementById("modal-error").style.display = "none";
  document.getElementById("modal-success").style.display = "none";
  document.getElementById("m-members").value = "";
  document.getElementById("m-purpose").value = "";
  const dateInput = document.getElementById("m-date");
  dateInput.value = "";
  dateInput.min = reservationTodayLocal();
  document.getElementById("m-start").value = "";
  document.getElementById("m-end").value = "";
  document.getElementById("book-modal").classList.add("open");
  syncBookingModalTimeBounds();
}

function closeModal() {
  document.getElementById("book-modal").classList.remove("open");
}

function showModalMsg(type, text) {
  ["modal-error", "modal-success"].forEach((id) => {
    document.getElementById(id).style.display = "none";
  });
  const el = document.getElementById("modal-" + type);
  el.textContent = text;
  el.style.display = "block";
}

async function submitReservation() {
  const members = document.getElementById("m-members").value.trim();
  const date = document.getElementById("m-date").value;
  const purpose = document.getElementById("m-purpose").value.trim();
  const start = document.getElementById("m-start").value;
  const end = document.getElementById("m-end").value;
  const btn = document.getElementById("submit-btn");

  if (!groupMembersHasNames(members))
    return showModalMsg(
      "error",
      "List each group member on its own line: Name – School ID number (11 digits)."
    );
  if (!date) return showModalMsg("error", "Please select a date.");
  if (!start || !end) return showModalMsg("error", "Please set start and end time.");
  if (start >= end) return showModalMsg("error", "End time must be after start time.");
  if (!purpose) return showModalMsg("error", "Please state the purpose of your reservation.");

  const libErr = reservationValidateLibraryHours(date, start, end);
  if (libErr) return showModalMsg("error", libErr);

  const pastErr = reservationValidateNotPast(date, start, end);
  if (pastErr) return showModalMsg("error", pastErr);

  const reservations = reservationsCache;
  const candidate = {
    roomNum: selectedRoom.n,
    roomName: "Confab " + selectedRoom.n,
    date,
    startTime: start,
    endTime: end,
  };
  const conflict = findStudentBookingConflict(candidate, reservations);
  if (conflict) {
    return showModalMsg(
      "error",
      "This room is already approved for that date and time (" +
        conflict.id +
        "). Pick another slot."
    );
  }

  const code = "REQ-" + Date.now().toString().slice(-7);
  const payload = {
    id: code,
    roomNum: selectedRoom.n,
    roomName: "Confab " + selectedRoom.n,
    loc: selectedRoom.loc,
    studentName: session.fname + " " + session.lname,
    studentEmail: session.email,
    sid: session.sid,
    members,
    date,
    startTime: start,
    endTime: end,
    purpose,
    status: "pending",
    submittedAt: new Date().toISOString(),
  };

  btn.textContent = "Submitting…";
  btn.disabled = true;
  try {
    await createReservationOnApi(payload);
    reservationsCache = await fetchReservationsFromApi();
    showModalMsg("success", "Reservation submitted! Your tracking code: " + code);
  } catch (e) {
    console.error(e);
    showModalMsg("error", e.message || "Could not save reservation. Try again.");
  } finally {
    btn.textContent = "Submit Reservation";
    btn.disabled = false;
  }
}

function renderMyReservations() {
  const all = reservationsCache;
  const mine = all.filter((r) => r.studentEmail === session.email);
  const container = document.getElementById("my-res-list");
  if (!mine.length) {
    container.innerHTML =
      '<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No reservations yet.</p></div>';
    return;
  }
  container.innerHTML =
    '<div class="reservation-list">' +
    mine
      .reverse()
      .map((r) => {
        const canTryCancel = r.status === "pending" || r.status === "approved";
        const cancelBlock = canTryCancel ? reservationStudentCancelBlockReason(r) : null;
        const showCancelBtn = canTryCancel && cancelBlock === null;
        const showCancelNote = canTryCancel && cancelBlock !== null;
        return `
    <div class="res-card">
      <div class="res-info">
        <h4>${r.roomName} <span style="font-size:11px;color:var(--text-faint);font-weight:400">— ${r.loc}</span></h4>
        <p>${r.date} &nbsp;|&nbsp; ${r.startTime} – ${r.endTime} &nbsp;|&nbsp; Code: <b>${r.id}</b></p>
        ${
          r.status === "rejected" && r.rejectReason
            ? `<p class="res-reject-note">${escapeHtml(r.rejectReason)}</p>`
            : ""
        }
        ${
          showCancelNote
            ? `<p class="res-cancel-note">${escapeHtml(cancelBlock)}</p>`
            : ""
        }
      </div>
      <div class="res-card-aside">
        ${showCancelBtn ? `<button type="button" class="btn-cancel-booking" onclick="cancelStudentReservation('${r.id}')">Cancel reservation</button>` : ""}
        <div class="status-badge status-${r.status}">${r.status}</div>
      </div>
    </div>
  `;
      })
      .join("") +
    "</div>";
}

async function cancelStudentReservation(id) {
  if (!session || !session.email) return;
  const all = reservationsCache;
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const r = all[idx];
  if (r.studentEmail !== session.email) return;
  const block = reservationStudentCancelBlockReason(r);
  if (block !== null) {
    alert(block);
    return;
  }
  if (!confirm("Cancel this reservation? This cannot be undone.")) return;
  try {
    await patchReservationOnApi({
      id,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      cancelledBy: "student",
    });
    reservationsCache = await fetchReservationsFromApi();
    renderMyReservations();
  } catch (e) {
    console.error(e);
    alert(e.message || "Could not cancel reservation.");
  }
}

function trackReservation() {
  const code = document.getElementById("track-code").value.trim().toUpperCase();
  const all = reservationsCache;
  const res = all.find((r) => r.id && String(r.id).toUpperCase() === code);
  const resultEl = document.getElementById("track-result");
  if (!res) {
    resultEl.innerHTML = '<div style="color:var(--danger);">Tracking code not found.</div>';
    resultEl.style.display = "block";
    return;
  }
  const statusColors = {
    pending: "#b8860b",
    approved: "var(--success)",
    rejected: "var(--danger)",
    cancelled: "#6b7280",
  };
  resultEl.innerHTML = `
    <div class="tr-row"><span class="tr-label">Room</span><span class="tr-val">${res.roomName}</span></div>
    <div class="tr-row"><span class="tr-label">Date</span><span class="tr-val">${res.date}</span></div>
    <div class="tr-row"><span class="tr-label">Time</span><span class="tr-val">${res.startTime} – ${res.endTime}</span></div>
    <div class="tr-row"><span class="tr-label">Reserved by</span><span class="tr-val">${res.studentName}</span></div>
    <div class="tr-row"><span class="tr-label">Status</span><span class="tr-val" style="color:${statusColors[res.status] || "#555"};font-weight:600;text-transform:capitalize">${res.status}</span></div>
    ${
      res.status === "cancelled" && res.cancelledAt
        ? '<div class="tr-row"><span class="tr-label">Cancelled</span><span class="tr-val">' +
          new Date(res.cancelledAt).toLocaleString() +
          "</span></div>"
        : ""
    }
    ${
      res.status === "rejected" && res.rejectReason
        ? '<div class="tr-row"><span class="tr-label">Message</span><span class="tr-val">' +
          escapeHtml(res.rejectReason) +
          "</span></div>"
        : ""
    }
  `;
  resultEl.style.display = "block";
}

function logout() {
  sessionStorage.removeItem("xu_session");
  window.location.href = "LogIn.html";
}
