const {
  listReservationsAction,
  createReservationAction,
  patchReservationAction,
} = require("./lib/bookingDb");
const { parseJsonBody } = require("./lib/parseEventBody");

const headers = { "Content-Type": "application/json" };

exports.handler = async (event, context) => {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  try {
    let r;
    if (event.httpMethod === "GET") {
      r = await listReservationsAction();
    } else if (event.httpMethod === "POST") {
      r = await createReservationAction(parseJsonBody(event));
    } else if (event.httpMethod === "PATCH") {
      r = await patchReservationAction(parseJsonBody(event));
    } else {
      return { statusCode: 405, headers, body: JSON.stringify({ message: "Method not allowed" }) };
    }
    return { statusCode: r.statusCode, headers, body: JSON.stringify(r.json) };
  } catch (err) {
    console.error("reservations:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ message: "Reservation request failed." }),
    };
  }
};
