/**
 * Netlify may send JSON as a string or base64-encoded.
 */
function parseJsonBody(event) {
  let raw = event.body;
  if (raw == null || raw === "") return {};
  if (event.isBase64Encoded && typeof raw === "string") {
    raw = Buffer.from(raw, "base64").toString("utf8");
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

module.exports = { parseJsonBody };
