const { listRoomsAction } = require("./lib/bookingDb");

const headers = { "Content-Type": "application/json" };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ message: "Method not allowed" }) };
  }
  try {
    const r = await listRoomsAction();
    return { statusCode: r.statusCode, headers, body: JSON.stringify(r.json) };
  } catch (err) {
    console.error("rooms:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Could not load rooms." }),
    };
  }
};
