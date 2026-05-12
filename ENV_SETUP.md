# Environment & deployment (Netlify + MongoDB)

This app uses **MongoDB Atlas** for **users**, **confab rooms** (`rooms` collection), and **reservations** (`reservations` collection, including group-member text and optional structured `groupMembers`). On **Netlify**, the database is reached only from **serverless functions** (`netlify/functions/`). The browser never sees your connection string.

---

## 1. Required secret (Netlify + local Functions)

| Variable        | Where to set it | Purpose |
|-----------------|-----------------|---------|
| `MONGODB_URI`   | Netlify: **Site configuration → Environment variables** | Functions connect to Atlas |
| `MONGODB_URI`   | Local: `js/.env` when running `node js/server.js` | Local Express API |

- Mark **`MONGODB_URI`** as **Contains secret values** in Netlify.
- Use **Same value for all deploy contexts** unless you maintain separate databases.
- After changing variables: **Deploys → Trigger deploy** (clear cache if unsure).

**Atlas:** **Network Access** must allow **`0.0.0.0/0`** (or Netlify will fail to connect).

**If registration or login returns HTTP 503:** the `register` / `login` function usually cannot read **`MONGODB_URI`** (wrong or missing **Functions** scope), the value is blank, or MongoDB is unreachable. Fix the variable, **redeploy**, and confirm Atlas allows **`0.0.0.0/0`**.

---

## 2. Deploy from GitHub to Netlify

1. Push this repo to GitHub (include `netlify.toml`, `package.json`, `package-lock.json`, `netlify/functions/`).
2. Netlify → **Add new site → Import from Git** → choose the repo.
3. Build settings are read from **`netlify.toml`**:
   - **Build command:** `npm install` (installs `mongoose` + `bcryptjs` for Functions)
   - **Publish directory:** `.` (site root)
   - **Functions:** `netlify/functions`
4. Add **`MONGODB_URI`** in Netlify (see above), then redeploy.
5. Open `https://<your-site>.netlify.app/LogIn.html`.

No extra build step is required for the static HTML/CSS/JS; `npm install` is enough for Functions.

---

## 3. Local development

1. Copy **`js/.env.example`** → **`js/.env`** and set **`MONGODB_URI`**.
2. From the **`js`** folder: `npm install` then `npm start` (or `node server.js`).
3. Open the site over **`http://127.0.0.1` or `http://localhost`** (e.g. Live Server). **`js/xu-api-base.js`** points the browser to **`http://127.0.0.1:3000/api`** on local/LAN hosts.

---

## 4. Netlify Functions ↔ Express routes

| Client path (`API_BASE` + suffix) | Netlify Function        | Express (`js/server.js`)   |
|-----------------------------------|-------------------------|----------------------------|
| `/login`                          | `login.js`              | `POST /api/login`          |
| `/register`                       | `register.js`           | `POST /api/register`       |
| `/users`                          | `users.js`              | `GET /api/users`           |
| `/admin-setup`                    | `admin-setup.js`        | `POST /api/admin-setup`    |
| `/rooms`                          | `rooms.js`              | `GET /api/rooms`           |
| `/reservations`                   | `reservations.js`       | `GET` / `POST` / `PATCH` `/api/reservations` |

`API_BASE` is `/.netlify/functions` on Netlify and `http://127.0.0.1:3000/api` locally.

---

## 5. Custom domain

If the site is **not** `*.netlify.app`, add the hostname to **`NETLIFY_PRODUCTION_HOSTS`** in **`js/xu-api-base.js`**, commit, and redeploy so API calls stay on **`/.netlify/functions`**.
