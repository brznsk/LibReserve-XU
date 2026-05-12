const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log("Connected to MongoDB Atlas"))
    .catch(err => console.error("DB Connection Error:", err));

const userSchema = new mongoose.Schema({
    fname: { type: String, required: true },
    lname: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    type: { type: String, enum: ['admin', 'staff', 'student'], required: true },
    sid: String,
    accountStatus: { type: String, default: 'active' },
    staffPortalAccess: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

const DEFAULT_ROOMS = [
    { roomNum: 1, loc: 'New Building · 5th floor', cap: 15, internet: 'School Wi‑Fi', whiteboard: false, projector: true },
    { roomNum: 2, loc: 'New Building · 5th floor', cap: 15, internet: 'School Wi‑Fi', whiteboard: false, projector: true },
    { roomNum: 3, loc: 'New Building · 4th floor', cap: 15, internet: 'LAN cable + school Wi‑Fi', whiteboard: true, projector: true },
    { roomNum: 4, loc: 'New Building · 4th floor', cap: 15, internet: 'LAN cable + school Wi‑Fi', whiteboard: true, projector: true },
    { roomNum: 5, loc: 'New Building · 3rd floor', cap: 15, internet: 'LAN cable + school Wi‑Fi', whiteboard: true, projector: true },
    { roomNum: 6, loc: 'New Building · 3rd floor', cap: 15, internet: 'LAN cable + school Wi‑Fi', whiteboard: true, projector: true },
];

const roomSchema = new mongoose.Schema({
    roomNum: { type: Number, required: true, unique: true },
    loc: { type: String, required: true },
    cap: { type: Number, required: true },
    internet: String,
    whiteboard: { type: Boolean, default: false },
    projector: { type: Boolean, default: false },
}, { collection: 'rooms' });

const reservationSchema = new mongoose.Schema({
    trackingCode: { type: String, required: true, unique: true, index: true },
    roomNum: { type: Number, required: true },
    roomName: String,
    loc: String,
    studentName: String,
    studentEmail: { type: String, required: true, index: true },
    sid: String,
    /** Multi-line "Name – School ID" list (same as browser storage). */
    members: { type: String, default: '' },
    /** Optional structured lines for reporting/search (not required for UI). */
    groupMembers: [{
        name: { type: String, trim: true },
        schoolId: { type: String, trim: true },
    }],
    date: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    purpose: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
        default: 'pending',
    },
    submittedAt: { type: Date, default: Date.now },
    reviewedAt: Date,
    reviewedBy: String,
    rejectReason: String,
    cancelledAt: Date,
    cancelledBy: String,
}, { collection: 'reservations' });

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);
const Reservation = mongoose.models.Reservation || mongoose.model('Reservation', reservationSchema);

function reservationToClient(doc) {
    const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (!o) return null;
    return {
        id: o.trackingCode,
        roomNum: o.roomNum,
        roomName: o.roomName,
        loc: o.loc,
        studentName: o.studentName,
        studentEmail: o.studentEmail,
        sid: o.sid,
        members: o.members,
        date: o.date,
        startTime: o.startTime,
        endTime: o.endTime,
        purpose: o.purpose,
        status: o.status,
        submittedAt: o.submittedAt ? new Date(o.submittedAt).toISOString() : undefined,
        reviewedAt: o.reviewedAt ? new Date(o.reviewedAt).toISOString() : undefined,
        reviewedBy: o.reviewedBy,
        rejectReason: o.rejectReason,
        cancelledAt: o.cancelledAt ? new Date(o.cancelledAt).toISOString() : undefined,
        cancelledBy: o.cancelledBy,
    };
}

function roomToClient(doc) {
    const o = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (!o) return null;
    return {
        n: o.roomNum,
        loc: o.loc,
        cap: o.cap,
        internet: o.internet || '',
        whiteboard: !!o.whiteboard,
        projector: !!o.projector,
    };
}

function parseGroupMemberLines(membersText) {
    const lines = String(membersText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
        const parts = line.split(/[–—\-]/).map((s) => s.trim());
        if (parts.length >= 2) {
            out.push({ name: parts[0], schoolId: parts.slice(1).join('-').trim() });
        } else if (line) {
            out.push({ name: line, schoolId: '' });
        }
    }
    return out;
}

async function seedRoomsIfEmpty() {
    const n = await Room.countDocuments();
    if (n > 0) return;
    await Room.insertMany(DEFAULT_ROOMS);
}

/** Session object for client (mirrors JWT claims: type + loginRole). */
function sessionPayload(userDoc, responseType, loginRole) {
    const o = userDoc.toObject();
    delete o.password;
    o.type = responseType;
    o.loginRole = loginRole;
    return o;
}

// 1. User Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, type } = req.body;
        const emailLower = String(email || '').toLowerCase();

        if (type === 'student') {
            const student = await User.findOne({ email: emailLower, type: 'student' });
            if (student) {
                if (student.accountStatus === 'inactive') {
                    return res.status(403).json({ message: "This account has been deactivated." });
                }
                const ok = await bcrypt.compare(password, student.password);
                if (!ok) return res.status(401).json({ message: "Invalid password." });
                return res.json(sessionPayload(student, 'student', 'student'));
            }

            if (/@my\.xu\.edu\.ph$/i.test(emailLower)) {
                const staff = await User.findOne({ email: emailLower, type: 'staff' });
                if (staff) {
                    if (staff.accountStatus === 'inactive') {
                        return res.status(403).json({ message: "This account has been deactivated." });
                    }
                    const okStaff = await bcrypt.compare(password, staff.password);
                    if (!okStaff) return res.status(401).json({ message: "Invalid password." });
                    return res.json(sessionPayload(staff, 'student', 'staff'));
                }
            }

            return res.status(401).json({ message: "Account not found for this role." });
        }

        if (type === 'staff') {
            const staffUser = await User.findOne({ email: emailLower, type: 'staff' });
            if (staffUser) {
                if (staffUser.accountStatus === 'inactive') {
                    return res.status(403).json({ message: "This account has been deactivated." });
                }
                const ok = await bcrypt.compare(password, staffUser.password);
                if (!ok) return res.status(401).json({ message: "Invalid password." });
                return res.json(sessionPayload(staffUser, 'staff', 'staff'));
            }
            const assistant = await User.findOne({
                email: emailLower,
                type: 'student',
                staffPortalAccess: true,
            });
            if (assistant) {
                if (assistant.accountStatus === 'inactive') {
                    return res.status(403).json({ message: "This account has been deactivated." });
                }
                const okA = await bcrypt.compare(password, assistant.password);
                if (!okA) return res.status(401).json({ message: "Invalid password." });
                return res.json(sessionPayload(assistant, 'staff', 'staff'));
            }
            return res.status(401).json({ message: "Account not found for this role." });
        }

        const user = await User.findOne({ email: emailLower, type });
        if (!user) {
            return res.status(401).json({ message: "Account not found for this role." });
        }
        if (user.accountStatus === 'inactive') {
            return res.status(403).json({ message: "This account has been deactivated." });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid password." });
        }

        const loginRole = type === 'admin' ? 'admin' : 'staff';
        res.json(sessionPayload(user, type, loginRole));
    } catch (err) {
        res.status(500).json({ message: "Server error during login." });
    }
});

// 2. Student Registration — returns session so client can auto-login
app.post('/api/register', async (req, res) => {
    try {
        const { fname, lname, sid, email, password, type } = req.body || {};
        const emailLower = String(email || '').trim().toLowerCase();

        if (!emailLower || !String(fname || '').trim() || !String(lname || '').trim() || !password) {
            return res.status(400).json({ message: "Please fill in all required fields (name, email, password)." });
        }
        if (type !== 'student') {
            return res.status(400).json({ message: "Invalid account type for registration." });
        }

        const existingUser = await User.findOne({ email: emailLower }).collation({ locale: 'en', strength: 2 });
        if (existingUser) {
            return res.status(400).json({ message: "Email already registered." });
        }

        const hashed = await bcrypt.hash(password, 10);

        const newUser = new User({
            fname: String(fname).trim(),
            lname: String(lname).trim(),
            sid: sid != null ? String(sid).trim() : undefined,
            email: emailLower,
            password: hashed,
            type: 'student'
        });

        try {
            await newUser.save();
        } catch (e) {
            if (e && e.code === 11000) {
                return res.status(400).json({ message: "Email already registered." });
            }
            throw e;
        }
        res.status(201).json(sessionPayload(newUser, 'student', 'student'));
    } catch (err) {
        console.error(err);
        if (err.name === 'ValidationError') {
            const first = Object.values(err.errors || {})[0];
            return res.status(400).json({ message: first?.message || 'Registration failed. Check all fields.' });
        }
        res.status(500).json({ message: "Registration failed. Please try again later." });
    }
});

// First admin only (matches Netlify admin-setup function)
app.post('/api/admin-setup', async (req, res) => {
    try {
        const adminCount = await User.countDocuments({ type: 'admin' });
        if (adminCount > 0) {
            return res.status(403).json({ message: 'An administrator already exists. Sign in from the login page.' });
        }
        const { fname, lname, email, password, type } = req.body || {};
        if (type !== 'admin') {
            return res.status(400).json({ message: 'Invalid account type.' });
        }
        const emailLower = String(email || '').trim().toLowerCase();
        if (!emailLower || !/^[^\s@]+@xu\.edu\.ph$/i.test(emailLower)) {
            return res.status(400).json({ message: 'Administrator email must be your official @xu.edu.ph address.' });
        }
        if (!String(fname || '').trim() || !String(lname || '').trim() || !password) {
            return res.status(400).json({ message: 'Please fill in all required fields.' });
        }
        const existingUser = await User.findOne({ email: emailLower }).collation({ locale: 'en', strength: 2 });
        if (existingUser) {
            return res.status(400).json({ message: 'That email is already registered.' });
        }
        const hashed = await bcrypt.hash(password, 10);
        await User.create({
            fname: String(fname).trim(),
            lname: String(lname).trim(),
            email: emailLower,
            password: hashed,
            type: 'admin',
        });
        res.status(201).json({ message: 'Administrator created successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not create administrator.' });
    }
});

// --- Confab rooms (MongoDB collection `rooms`) ---
app.get('/api/rooms', async (req, res) => {
    try {
        await seedRoomsIfEmpty();
        const list = await Room.find({}).sort({ roomNum: 1 }).lean();
        res.json(list.map((r) => roomToClient(r)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not load rooms.' });
    }
});

// --- Reservations (MongoDB collection `reservations`; members + optional groupMembers) ---
app.get('/api/reservations', async (req, res) => {
    try {
        const list = await Reservation.find({}).sort({ submittedAt: -1 }).lean();
        res.json(list.map((r) => reservationToClient(r)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not load reservations.' });
    }
});

app.post('/api/reservations', async (req, res) => {
    try {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ message: 'Missing reservation id (tracking code).' });
        const exists = await Reservation.findOne({ trackingCode: id });
        if (exists) return res.status(400).json({ message: 'Tracking code already exists.' });

        const doc = {
            trackingCode: id,
            roomNum: Number(b.roomNum),
            roomName: b.roomName || `Confab ${b.roomNum}`,
            loc: b.loc || '',
            studentName: b.studentName || '',
            studentEmail: String(b.studentEmail || '').toLowerCase(),
            sid: b.sid || '',
            members: b.members != null ? String(b.members) : '',
            groupMembers: parseGroupMemberLines(b.members),
            date: b.date,
            startTime: b.startTime,
            endTime: b.endTime,
            purpose: b.purpose || '',
            status: 'pending',
            submittedAt: b.submittedAt ? new Date(b.submittedAt) : new Date(),
        };
        if (!doc.studentEmail || !doc.date || !doc.startTime || !doc.endTime) {
            return res.status(400).json({ message: 'Missing required reservation fields.' });
        }
        const created = await Reservation.create(doc);
        res.status(201).json(reservationToClient(created));
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Tracking code already exists.' });
        }
        res.status(500).json({ message: 'Could not create reservation.' });
    }
});

app.patch('/api/reservations', async (req, res) => {
    try {
        const b = req.body || {};
        const id = String(b.id || '').trim();
        if (!id) return res.status(400).json({ message: 'Missing reservation id.' });

        const allowed = ['status', 'reviewedAt', 'reviewedBy', 'rejectReason', 'cancelledAt', 'cancelledBy'];
        const update = {};
        for (const k of allowed) {
            if (b[k] !== undefined) update[k] = b[k];
        }
        if (update.reviewedAt && typeof update.reviewedAt === 'string') {
            update.reviewedAt = new Date(update.reviewedAt);
        }
        if (update.cancelledAt && typeof update.cancelledAt === 'string') {
            update.cancelledAt = new Date(update.cancelledAt);
        }
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ message: 'No valid fields to update.' });
        }

        const row = await Reservation.findOneAndUpdate(
            { trackingCode: id },
            { $set: update },
            { new: true }
        );
        if (!row) return res.status(404).json({ message: 'Reservation not found.' });
        res.json(reservationToClient(row));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Could not update reservation.' });
    }
});

// 4. Get All Users
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, '-password');
        res.json(users);
    } catch (err) {
        res.status(500).json({ message: "Could not fetch users." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
