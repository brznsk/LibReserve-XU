const mongoose = require("mongoose");
const { getMongoUriOrThrow } = require("./mongoUri");
const { ensureBuiltinDemoAdminWhenConnected } = require("./authLogic");

let connectPromise = null;

async function ensureDb() {
  if (mongoose.connection.readyState === 1) {
    await ensureBuiltinDemoAdminWhenConnected();
    return;
  }
  const uri = getMongoUriOrThrow();
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000, 
    });
  }
  await connectPromise;
  await ensureBuiltinDemoAdminWhenConnected();
}

const DEFAULT_ROOMS = [
  { roomNum: 1, loc: "New Building · 5th floor", cap: 15, internet: "School Wi‑Fi", whiteboard: false, projector: true },
  { roomNum: 2, loc: "New Building · 5th floor", cap: 15, internet: "School Wi‑Fi", whiteboard: false, projector: true },
  { roomNum: 3, loc: "New Building · 4th floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { roomNum: 4, loc: "New Building · 4th floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { roomNum: 5, loc: "New Building · 3rd floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
  { roomNum: 6, loc: "New Building · 3rd floor", cap: 15, internet: "LAN cable + school Wi‑Fi", whiteboard: true, projector: true },
];

const roomSchema = new mongoose.Schema(
  {
    roomNum: { type: Number, required: true, unique: true },
    loc: { type: String, required: true },
    cap: { type: Number, required: true },
    internet: String,
    whiteboard: { type: Boolean, default: false },
    projector: { type: Boolean, default: false },
  },
  { collection: "rooms" }
);

const reservationSchema = new mongoose.Schema(
  {
    trackingCode: { type: String, required: true, unique: true, index: true },
    roomNum: { type: Number, required: true },
    roomName: String,
    loc: String,
    studentName: String,
    studentEmail: { type: String, required: true, index: true },
    sid: String,
    members: { type: String, default: "" },
    groupMembers: [{ name: String, schoolId: String }],
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    purpose: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: String,
    rejectReason: String,
    cancelledAt: Date,
    cancelledBy: String,
  },
  { collection: "reservations" }
);

const Room = mongoose.models.Room || mongoose.model("Room", roomSchema);
const Reservation = mongoose.models.Reservation || mongoose.model("Reservation", reservationSchema);

function reservationToClient(o) {
  if (!o) return null;
  const plain = o.toObject ? o.toObject() : o;
  return {
    id: plain.trackingCode,
    roomNum: plain.roomNum,
    roomName: plain.roomName,
    loc: plain.loc,
    studentName: plain.studentName,
    studentEmail: plain.studentEmail,
    sid: plain.sid,
    members: plain.members,
    date: plain.date,
    startTime: plain.startTime,
    endTime: plain.endTime,
    purpose: plain.purpose,
    status: plain.status,
    submittedAt: plain.submittedAt ? new Date(plain.submittedAt).toISOString() : undefined,
    reviewedAt: plain.reviewedAt ? new Date(plain.reviewedAt).toISOString() : undefined,
    reviewedBy: plain.reviewedBy,
    rejectReason: plain.rejectReason,
    cancelledAt: plain.cancelledAt ? new Date(plain.cancelledAt).toISOString() : undefined,
    cancelledBy: plain.cancelledBy,
  };
}

function roomToClient(o) {
  if (!o) return null;
  const plain = o.toObject ? o.toObject() : o;
  return {
    n: plain.roomNum,
    loc: plain.loc,
    cap: plain.cap,
    internet: plain.internet || "",
    whiteboard: !!plain.whiteboard,
    projector: !!plain.projector,
  };
}

function parseGroupMemberLines(membersText) {
  const lines = String(membersText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(/[–—\-]/).map((s) => s.trim());
    if (parts.length >= 2) {
      out.push({ name: parts[0], schoolId: parts.slice(1).join("-").trim() });
    } else if (line) {
      out.push({ name: line, schoolId: "" });
    }
  }
  return out;
}

async function seedRoomsIfEmpty() {
  const n = await Room.countDocuments();
  if (n > 0) return;
  await Room.insertMany(DEFAULT_ROOMS);
}

async function listRoomsAction() {
  await ensureDb();
  await seedRoomsIfEmpty();
  const list = await Room.find({}).sort({ roomNum: 1 }).lean();
  return { statusCode: 200, json: list.map((r) => roomToClient(r)) };
}

async function listReservationsAction() {
  await ensureDb();
  const list = await Reservation.find({}).sort({ submittedAt: -1 }).lean();
  return { statusCode: 200, json: list.map((r) => reservationToClient(r)) };
}

async function createReservationAction(body) {
  await ensureDb();
  const b = body || {};
  const id = String(b.id || "").trim();
  if (!id) return { statusCode: 400, json: { message: "Missing reservation id (tracking code)." } };
  const exists = await Reservation.findOne({ trackingCode: id });
  if (exists) return { statusCode: 400, json: { message: "Tracking code already exists." } };

  const doc = {
    trackingCode: id,
    roomNum: Number(b.roomNum),
    roomName: b.roomName || `Confab ${b.roomNum}`,
    loc: b.loc || "",
    studentName: b.studentName || "",
    studentEmail: String(b.studentEmail || "").toLowerCase(),
    sid: b.sid || "",
    members: b.members != null ? String(b.members) : "",
    groupMembers: parseGroupMemberLines(b.members),
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    purpose: b.purpose || "",
    status: "pending",
    submittedAt: b.submittedAt ? new Date(b.submittedAt) : new Date(),
  };
  if (!doc.studentEmail || !doc.date || !doc.startTime || !doc.endTime) {
    return { statusCode: 400, json: { message: "Missing required reservation fields." } };
  }
  try {
    const created = await Reservation.create(doc);
    return { statusCode: 201, json: reservationToClient(created) };
  } catch (e) {
    if (e.code === 11000) {
      return { statusCode: 400, json: { message: "Tracking code already exists." } };
    }
    throw e;
  }
}

async function patchReservationAction(body) {
  await ensureDb();
  const b = body || {};
  const id = String(b.id || "").trim();
  if (!id) return { statusCode: 400, json: { message: "Missing reservation id." } };

  const allowed = ["status", "reviewedAt", "reviewedBy", "rejectReason", "cancelledAt", "cancelledBy"];
  const update = {};
  for (const k of allowed) {
    if (b[k] !== undefined) update[k] = b[k];
  }
  if (update.reviewedAt && typeof update.reviewedAt === "string") {
    update.reviewedAt = new Date(update.reviewedAt);
  }
  if (update.cancelledAt && typeof update.cancelledAt === "string") {
    update.cancelledAt = new Date(update.cancelledAt);
  }
  if (Object.keys(update).length === 0) {
    return { statusCode: 400, json: { message: "No valid fields to update." } };
  }

  const row = await Reservation.findOneAndUpdate({ trackingCode: id }, { $set: update }, { new: true });
  if (!row) return { statusCode: 404, json: { message: "Reservation not found." } };
  return { statusCode: 200, json: reservationToClient(row) };
}

module.exports = {
  listRoomsAction,
  listReservationsAction,
  createReservationAction,
  patchReservationAction,
};
