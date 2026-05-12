let session = null;
let currentFilter = "all";
let currentDetail = null;
/** @type {Array<object>} */
let reservationsCache = [];

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
    reservationsCache = await fetchReservationsFromApi();
  } catch (e) {
    console.error(e);
    reservationsCache = [];
    showPageAlert("error", "Could not load reservations from the server.");
  }
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

function logout() {
  sessionStorage.removeItem("xu_session");
  window.location.href = "LogIn.html";
}
