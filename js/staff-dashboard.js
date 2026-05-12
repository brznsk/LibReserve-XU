let session = null;
let currentFilter = "all";
let currentDetail = null;
/** @type {Array<object>} */
let reservationsCache = [];
/** @type {Array<object>} */
let rooms = [];

/** Background refresh from MongoDB (no toast). */
const RESERVATIONS_AUTO_REFRESH_MS = 30000;

async function pullReservationsAndRender() {
  try {
    await refreshStaffReservationsFromApi();
    updateStats();
    renderTable();
  } catch (e) {
    console.warn("Reservation refresh failed", e);
  }
}

(function scheduleConstants() {})();
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

(async function staffDeskInit() {
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
  const staffBookingOnly = live.type === "staff" && session.type === "student";
  if (staffBookingOnly) {
    window.location.href = "StudentDashBoard.html";
    return;
  }

  const canDesk =
    live.type === "staff" ||
    live.type === "admin" ||
    (live.type === "student" && live.staffPortalAccess && session.type === "staff");
  if (!canDesk) {
    window.location.href = "StudentDashBoard.html";
    return;
  }
  session.fname = live.fname;
  session.lname = live.lname;
  session.type =
    live.type === "student" && live.staffPortalAccess && session.type === "staff"
      ? "staff"
      : live.type;
  session.loginRole =
    session.loginRole ||
    (live.type === "admin" ? "admin" : live.type === "staff" ? "staff" : "student");
  session.staffPortalAccess = !!live.staffPortalAccess;
  sessionStorage.setItem("xu_session", JSON.stringify(session));

  const badge = document.getElementById("role-badge");
  if (badge) {
    if (live.type === "admin") badge.textContent = "ADMIN";
    else if (live.type === "student" && live.staffPortalAccess) badge.textContent = "ASSISTANT";
    else badge.textContent = "STAFF";
  }

  const adminPanelLink = document.getElementById("link-admin-panel");
  if (adminPanelLink) {
    adminPanelLink.style.display = live.type === "admin" ? "inline-flex" : "none";
  }

  const portalLink = document.getElementById("link-student-portal");
  if (portalLink && live.type === "student" && live.staffPortalAccess) {
    portalLink.style.display = "inline-flex";
  } else if (portalLink) {
    portalLink.style.display = "none";
  }

  const initials = ((session.fname || "S")[0] + (session.lname || "T")[0]).toUpperCase();
  document.getElementById("user-avatar").textContent = initials;
  document.getElementById("user-name").textContent =
    (session.fname || "") + " " + (session.lname || "");
  try {
    try {
      rooms = await fetchRoomsFromApi();
    } catch (e) {
      console.warn("Rooms API failed; schedule room picker may be limited.", e);
      rooms = [];
    }
    reservationsCache = await fetchReservationsFromApi();
  } catch (e) {
    console.error(e);
    reservationsCache = [];
    showPageAlert("error", "Could not load reservations from the server.");
  }
  bindScheduleModal();
  updateStats();
  renderTable();

  setInterval(() => void pullReservationsAndRender(), RESERVATIONS_AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pullReservationsAndRender();
  });
})();

async function refreshStaffReservationsFromApi() {
  reservationsCache = await fetchReservationsFromApi();
}

function getReservations() {
  return reservationsCache;
}

function rowToApiPatch(r) {
  return {
    id: r.id,
    status: r.status,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy,
    rejectReason: r.rejectReason,
    cancelledAt: r.cancelledAt,
    cancelledBy: r.cancelledBy,
  };
}

function escapeHtmlStaff(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateStats() {
  const totalEl = document.getElementById("stat-total");
  if (!totalEl) return;
  const all = getReservations();
  document.getElementById("stat-total").textContent = all.length;
  document.getElementById("stat-pending").textContent = all.filter((r) => r.status === "pending").length;
  document.getElementById("stat-approved").textContent = all.filter((r) => r.status === "approved").length;
  document.getElementById("stat-rejected").textContent = all.filter((r) => r.status === "rejected").length;
  document.getElementById("stat-cancelled").textContent = all.filter((r) => r.status === "cancelled").length;
}

function switchTab(filter, el) {
  currentFilter = filter;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  renderTable();
}

function openScheduleModal(roomNum) {
  const modal = document.getElementById("schedule-modal");
  if (!modal) return;

  const select = document.getElementById("schedule-room");
  if (select) {
    const list = rooms && rooms.length ? rooms : [];
    const roomNums = list.length ? list.map((r) => r.n) : [1, 2, 3, 4, 5, 6];
    select.innerHTML = roomNums
      .map((n) => `<option value="${n}">Confab ${n}</option>`)
      .join("");
  }

  scheduleRoomViewing = roomNum || scheduleRoomViewing || 1;
  scheduleViewWeekOffset = 0;
  if (select) select.value = String(scheduleRoomViewing);
  modal.classList.add("open");
  renderScheduleWeekStaff();
}

function closeScheduleModal() {
  const modal = document.getElementById("schedule-modal");
  if (modal) modal.classList.remove("open");
}

function bindScheduleModal() {
  const prev = document.getElementById("schedule-prev-week");
  const next = document.getElementById("schedule-next-week");
  const today = document.getElementById("schedule-this-week");
  const overlay = document.getElementById("schedule-modal");
  const select = document.getElementById("schedule-room");
  if (prev)
    prev.addEventListener("click", () => {
      scheduleViewWeekOffset--;
      renderScheduleWeekStaff();
    });
  if (next)
    next.addEventListener("click", () => {
      scheduleViewWeekOffset++;
      renderScheduleWeekStaff();
    });
  if (today)
    today.addEventListener("click", () => {
      scheduleViewWeekOffset = 0;
      renderScheduleWeekStaff();
    });
  if (select)
    select.addEventListener("change", () => {
      scheduleRoomViewing = Number(select.value);
      scheduleViewWeekOffset = 0;
      renderScheduleWeekStaff();
    });
  if (overlay)
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeScheduleModal();
    });
}

function renderScheduleWeekStaff() {
  const root = document.getElementById("schedule-cal-root");
  const titleEl = document.getElementById("schedule-modal-title");
  const labelEl = document.getElementById("schedule-week-label");
  if (!root || scheduleRoomViewing == null) return;

  const room = rooms.find((r) => r.n === scheduleRoomViewing);
  if (titleEl) {
    titleEl.textContent =
      "Confab " + scheduleRoomViewing + " — weekly schedule · " + (room ? room.loc : "");
  }

  const monday = getMondayOfDate(new Date());
  monday.setDate(monday.getDate() + scheduleViewWeekOffset * 7);
  const sun = new Date(monday);
  sun.setDate(monday.getDate() + 6);
  if (labelEl) {
    labelEl.textContent =
      monday.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " – " +
      sun.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

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
      const student = escapeHtmlStaff(r.studentName || "Student");
      const code = escapeHtmlStaff(r.id || "");
      blocksHtml +=
        '<div class="schedule-block" style="top:' +
        st.top +
        ";height:" +
        st.height +
        '" title="' +
        student +
        " · " +
        code +
        '"><span class="schedule-block-time">' +
        rangeLabel +
        '</span><span class="schedule-block-title">' +
        student +
        '</span><span class="schedule-block-meta">' +
        code +
        "</span></div>";
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

function renderTable() {
  const all = getReservations();
  const searchEl = document.getElementById("search-input");
  const q = (searchEl && searchEl.value ? searchEl.value : "").toLowerCase();
  let filtered = all.filter((r) => {
    if (currentFilter !== "all" && r.status !== currentFilter) return false;
    if (q) {
      const haystack = (
        (r.id || "") +
        (r.roomName || "") +
        (r.studentName || "") +
        (r.purpose || "") +
        (r.studentEmail || "")
      ).toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sortEl = document.getElementById("desk-sort");
  const newestFirst = sortEl && sortEl.value === "newest";
  filtered.sort((a, b) => {
    const ta = new Date(a.submittedAt || 0).getTime();
    const tb = new Date(b.submittedAt || 0).getTime();
    return newestFirst ? tb - ta : ta - tb;
  });

  const tbody = document.getElementById("res-tbody");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p>No reservations found.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (r) => `
    <tr>
      <td><b>${r.id}</b></td>
      <td>${r.roomName}</td>
      <td>
        <div style="font-weight:500">${r.studentName}</div>
        <div style="font-size:11px;color:var(--text-faint)">${r.studentEmail}</div>
      </td>
      <td>
        <div>${r.date}</div>
        <div style="font-size:12px;color:var(--text-soft)">${r.startTime} – ${r.endTime}</div>
        ${
          r.status === "pending" && r.submittedAt
            ? `<div style="font-size:10px;color:var(--text-faint);margin-top:4px">Submitted ${new Date(
                r.submittedAt
              ).toLocaleString()}</div>`
            : ""
        }
      </td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.purpose}</td>
      <td><span class="status-badge status-${r.status}">${r.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-view" onclick="viewDetail('${r.id}')">View</button>
          <button class="btn-view" onclick="openScheduleModal(${Number(r.roomNum) || 1})">Calendar</button>
          ${
            r.status === "pending"
              ? `
            <button class="btn-approve" onclick="updateStatus('${r.id}','approved')">Approve</button>
            <button class="btn-reject" onclick="updateStatus('${r.id}','rejected')">Reject</button>
          `
              : ""
          }
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

async function updateStatus(id, newStatus) {
  const list = getReservations();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return;
  const row = list[idx];

  if (newStatus === "approved") {
    const libErr = reservationValidateLibraryHours(row.date, row.startTime, row.endTime);
    if (libErr) {
      showPageAlert("error", "Cannot approve: " + libErr);
      return;
    }
    const pastErr = reservationValidateNotPast(row.date, row.startTime, row.endTime);
    if (pastErr) {
      showPageAlert("error", "Cannot approve: " + pastErr);
      return;
    }
    const conflict = findApprovedBookingConflict(row, list, id);
    if (conflict) {
      showPageAlert(
        "error",
        "Cannot approve: the room is already booked for that time (" +
          conflict.id +
          ", " +
          conflict.studentName +
          ", " +
          conflict.startTime +
          "–" +
          conflict.endTime +
          "). Reject this request or adjust the schedule."
      );
      return;
    }

    list[idx].status = "approved";
    list[idx].reviewedAt = new Date().toISOString();
    list[idx].reviewedBy = session.email;
    const bumped = autoRejectPendingConflictsAfterApproval(list, list[idx], session.email);
    const idsToSync = [id].concat(bumped.bumpedIds || []);
    try {
      for (const syncId of idsToSync) {
        const r = list.find((x) => x.id === syncId);
        if (r) await patchReservationOnApi(rowToApiPatch(r));
      }
      await refreshStaffReservationsFromApi();
    } catch (e) {
      console.error(e);
      showPageAlert("error", e.message || "Could not save to database.");
      return;
    }
    updateStats();
    renderTable();
    closeModal();
    showPageAlert(
      "success",
      bumped.count > 0
        ? "Approved " +
            id +
            ". " +
            bumped.count +
            " overlapping pending request(s) were rejected (students see the reason on Track status)."
        : "Reservation " + id + " approved."
    );
    return;
  }

  list[idx].status = newStatus;
  list[idx].reviewedAt = new Date().toISOString();
  list[idx].reviewedBy = session.email;
  if (newStatus === "rejected") {
    list[idx].rejectReason = "Rejected by library staff.";
  }
  try {
    await patchReservationOnApi(rowToApiPatch(list[idx]));
    await refreshStaffReservationsFromApi();
  } catch (e) {
    console.error(e);
    showPageAlert("error", e.message || "Could not save to database.");
    return;
  }
  updateStats();
  renderTable();
  closeModal();
  showPageAlert("success", "Reservation " + id + " has been " + newStatus + ".");
}

function viewDetail(id) {
  const modal = document.getElementById("detail-modal");
  const grid = document.getElementById("detail-grid");
  const footer = document.getElementById("detail-footer");
  if (!modal || !grid || !footer) return;

  const list = getReservations();
  currentDetail = list.find((r) => r.id === id);
  if (!currentDetail) return;
  const r = currentDetail;
  grid.innerHTML = `
    <div class="detail-item"><div class="detail-label">Tracking Code</div><div class="detail-val">${r.id}</div></div>
    <div class="detail-item"><div class="detail-label">Status</div><div class="detail-val"><span class="status-badge status-${r.status}">${r.status}</span></div></div>
    <div class="detail-item"><div class="detail-label">Room</div><div class="detail-val">${r.roomName}</div></div>
    <div class="detail-item"><div class="detail-label">Location</div><div class="detail-val">${r.loc}</div></div>
    <div class="detail-item"><div class="detail-label">Student Name</div><div class="detail-val">${r.studentName}</div></div>
    <div class="detail-item"><div class="detail-label">Student Email</div><div class="detail-val">${r.studentEmail}</div></div>
    <div class="detail-item"><div class="detail-label">School ID</div><div class="detail-val">${r.sid || "—"}</div></div>
    <div class="detail-item"><div class="detail-label">Date</div><div class="detail-val">${r.date}</div></div>
    <div class="detail-item"><div class="detail-label">Time</div><div class="detail-val">${r.startTime} – ${r.endTime}</div></div>
    <div class="detail-item"><div class="detail-label">Purpose</div><div class="detail-val">${r.purpose}</div></div>
    <div class="detail-item full"><div class="detail-label">Group Members</div><div class="detail-val members">${r.members}</div></div>
    <div class="detail-item"><div class="detail-label">Submitted</div><div class="detail-val">${
      r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"
    }</div></div>
    ${
      r.status === "cancelled" && r.cancelledAt
        ? `<div class="detail-item"><div class="detail-label">Cancelled</div><div class="detail-val">${new Date(
            r.cancelledAt
          ).toLocaleString()}${r.cancelledBy ? " (" + escapeHtmlStaff(r.cancelledBy) + ")" : ""}</div></div>`
        : ""
    }
    ${
      r.status === "rejected" && r.rejectReason
        ? `<div class="detail-item full"><div class="detail-label">Message to student</div><div class="detail-val">${escapeHtmlStaff(
            r.rejectReason
          )}</div></div>`
        : ""
    }
  `;
  if (r.status === "pending") {
    footer.innerHTML = `
      <button class="btn-mfull neutral" onclick="closeModal()">Close</button>
      <button class="btn-mfull reject" onclick="updateStatus('${r.id}','rejected')">Reject</button>
      <button class="btn-mfull approve" onclick="updateStatus('${r.id}','approved')">Approve</button>
    `;
  } else {
    footer.innerHTML = `<button class="btn-mfull neutral" onclick="closeModal()">Close</button>`;
  }
  modal.classList.add("open");
}

function closeModal() {
  const modal = document.getElementById("detail-modal");
  if (modal) modal.classList.remove("open");
}

function showPageAlert(type, text) {
  const el = document.getElementById("page-alert");
  if (!el) return;
  el.className = "alert-top " + type;
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

async function refreshList() {
  try {
    await refreshStaffReservationsFromApi();
    updateStats();
    renderTable();
    showPageAlert("success", "Refresh complete.");
  } catch (e) {
    console.error(e);
    showPageAlert("error", e.message || "Could not refresh.");
  }
}

function logout() {
  sessionStorage.removeItem("xu_session");
  window.location.href = "LogIn.html";
}
