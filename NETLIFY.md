# Deploy LibReserve on Netlify

The static HTML/CSS/JS is published from the repo root. Auth calls go to **Netlify Functions** at `/.netlify/functions/{login,register,users}`, which use the same MongoDB logic as `js/server.js`.

## 1. Environment variable

In the Netlify UI: **Site configuration → Environment variables**

| Name           | Value                                      |
|----------------|--------------------------------------------|
| `MONGODB_URI`  | Your MongoDB Atlas connection string       |

Redeploy after adding or changing variables.

## 2. Connect the site

- **New site from Git** → pick this repo.
- Netlify reads **`netlify.toml`**: `publish = "."`, `functions = "netlify/functions"`.
- Root **`package.json`** installs `mongoose` and `bcryptjs` for functions.

## 3. Custom domain

If the site is served at something other than `*.netlify.app`, open **`js/xu-api-base.js`** and add that hostname to **`NETLIFY_PRODUCTION_HOSTS`** (for example your library subdomain). That keeps API calls on `/.netlify/functions` on the same origin.

## 4. Local API vs Netlify

- **Local / Live Server:** `xu-api-base.js` uses `http://127.0.0.1:3000/api` — run `node js/server.js` from the `js` folder (with `.env` there).
- **Netlify:** no need to run Express; functions handle login, register, and user list.

## 5. AdminInit / `admin-setup`

`AdminInit.html` calls `/admin-setup`, which is **not** implemented in these functions. Create the first admin in MongoDB (Atlas UI or Compass) or run the Express server once with a setup route if you add it later.

## 6. Quick test after deploy

1. Open `https://<your-site>.netlify.app/LogIn.html`
2. Sign in — check **Netlify → Functions → login** logs if something fails.
3. Confirm **`MONGODB_URI`** is set (missing URI shows a 500 and a log line about env).

---

## Fix: “Server error during login” (step by step)

That message means the **`login`** Netlify Function returned HTTP **500**. Work through these in order.

### Step 1 — Confirm the browser is calling Netlify Functions

1. Open your live site → **LogIn.html**.
2. Press **F12** → **Network** tab.
3. Try signing in.
4. Click the request named **`login`** (or the URL ending in **`/.netlify/functions/login`**).

**If there is no `login` request, or the URL points to `127.0.0.1` or Railway:**  
Your **`js/xu-api-base.js`** is not using Netlify. Fix:

- If the site URL is **`https://something.netlify.app`** → it should use **`/.netlify/functions`** automatically.
- If you use a **custom domain** (not `*.netlify.app`) → add that exact hostname to **`NETLIFY_PRODUCTION_HOSTS`** in **`js/xu-api-base.js`**, commit, redeploy.

### Step 2 — Set `MONGODB_URI` in Netlify (most common fix)

1. Netlify dashboard → your site → **Site configuration** → **Environment variables**.
2. Click **Add a variable** → **Add a single variable**.
3. **Key:** `MONGODB_URI` (same spelling, all caps).
4. **Value:** your Atlas connection string (starts with `mongodb+srv://...`).
5. **Scopes:** include **Production** (and **Deploy previews** if you test PRs).
6. **Save**, then **trigger a new deploy** ( **Deploys** → **Trigger deploy** → **Clear cache and deploy site** ).  
   *New env vars are not applied to old deploys until you redeploy.*

### Step 3 — Allow Atlas to accept Netlify’s servers

1. [MongoDB Atlas](https://cloud.mongodb.com) → your project → **Network Access**.
2. **Add IP Address** → **Allow access from anywhere** → `0.0.0.0/0` (Atlas describes this as needed for many cloud/serverless hosts).  
   *If you only allow your home IP, Netlify Functions will fail to connect.*

### Step 4 — Read the real error in Netlify

1. Netlify → **Functions** → **`login`**.
2. Open **Logs** (or **Observability / Real-time logs** while you try logging in).
3. Look for **`MONGODB_URI`**, **`authentication failed`**, **`ENOTFOUND`**, **`SSL`**, etc.

Typical meanings:

| Log hint | What to do |
|----------|------------|
| `MONGODB_URI is not set` | Step 2 + redeploy |
| `bad auth` / `authentication failed` | Wrong DB user/password in the URI; reset in Atlas and update the variable |
| `ENOTFOUND` / DNS | Check cluster hostname in the URI; cluster not paused |

### Step 5 — Confirm Functions are deployed

1. Netlify → **Functions** — you should see **`login`**, **`register`**, **`users`**.
2. If the list is empty, the repo may be missing **`netlify/functions`** or **`netlify.toml`**, or the build failed — open the **Deploy log** and fix errors.

### Step 6 — Wrong password vs server error

- **“Invalid password”** or **“Account not found for this role”** → API is working; fix tile (Student vs Library Staff vs Administrator), email, or password.
- **“Server error during login”** or **“Database not configured…”** → still an infrastructure/config issue (Steps 2–5).
