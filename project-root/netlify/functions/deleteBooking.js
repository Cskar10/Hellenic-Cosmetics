const { Client } = require("pg");
const jwt = require("jsonwebtoken");

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 1. Verify Netlify Identity token
    const authHeader = event.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing token" }) };
    }

    // Validate Netlify Identity JWT
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.email) {
      return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
    }

    // 2. Parse request body
    const { id } = JSON.parse(event.body);
    if (!id) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing booking ID" }) };
    }

    // 3. Connect to PostgreSQL
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    // 4. Perform deletion
    await client.query("DELETE FROM bookings WHERE id = $1", [id]);
    await client.end();

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Booking deleted successfully" }),
    };
  } catch (error) {
    console.error("Delete booking error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
