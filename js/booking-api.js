/** Uses window.XU_API_BASE from js/xu-api-base.js (load before this file). */
function bookingApiBase() {
  return (
    window.XU_API_BASE ||
    (console.warn("[LibReserve] xu-api-base.js missing; using http://127.0.0.1:3000/api"),
    "http://127.0.0.1:3000/api")
  );
}s

async function fetchReservationsFromApi() {
  const r = await fetch(`${bookingApiBase()}/reservations`);
  if (!r.ok) throw new Error("Could not load reservations.");
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

async function fetchRoomsFromApi() {
  const r = await fetch(`${bookingApiBase()}/rooms`);
  if (!r.ok) throw new Error("Could not load rooms.");
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

/**
 * @param {object} payload — same shape as legacy localStorage row; must include `id` (tracking code REQ-…).
 */
async function createReservationOnApi(payload) {
  const r = await fetch(`${bookingApiBase()}/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Could not save reservation.");
  return j;
}

/**
 * @param {object} patch — must include `id` (tracking code); other fields merged (whitelist on server).
 */
async function patchReservationOnApi(patch) {
  const r = await fetch(`${bookingApiBase()}/reservations`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Could not update reservation.");
  return j;
}
