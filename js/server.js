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
