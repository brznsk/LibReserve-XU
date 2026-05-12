/**
 * @returns {string} trimmed Atlas URI
 * @throws {Error} code `MISSING_MONGODB_URI` when unset/blank
 */
function getMongoUriOrThrow() {
  const raw = process.env.MONGODB_URI;
  const uri = raw != null ? String(raw).trim() : "";
  if (!uri) {
    const err = new Error(
      "MONGODB_URI is missing or empty. In Netlify: Site configuration → Environment variables → add MONGODB_URI, mark as secret, enable scope **Functions** (or All scopes), then redeploy."
    );
    err.code = "MISSING_MONGODB_URI";
    throw err;
  }
  return uri;
}

module.exports = { getMongoUriOrThrow };
