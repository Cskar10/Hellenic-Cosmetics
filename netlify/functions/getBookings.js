const { Client } = require("pg");
const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
  try {
    // --- Authorization ---
    const authHeader = event.headers.authorization;
    if (!authHeader) return { statusCode: 401, body: "Unauthorized" };

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token);
    if (!decoded) return { statusCode: 401, body: "Invalid token" };

    // --- Connect to DB ---
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    // --- Query bookings ---
    const result = await client.query(`
      SELECT id, name, email, service,
             appointment_datetime_local,
             appointment_datetime_utc,
             created_at
      FROM bookings
      ORDER BY appointment_datetime_local ASC;
    `);

    await client.end();

    // --- Step 3: Format date/time for display ---
    const formatted = result.rows.map((b) => {
      let localDateTime = null;
      let date = "Invalid Date";
      let time = "Invalid Time";

      if (b.appointment_datetime_local) {
        localDateTime = new Date(b.appointment_datetime_local);
        if (!isNaN(localDateTime.getTime())) {
          date = localDateTime.toLocaleDateString("en-AU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          });
          time = localDateTime.toLocaleTimeString("en-AU", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        }
      }

      const createdAt = new Date(b.created_at);
      const createdDate = !isNaN(createdAt.getTime())
        ? createdAt.toLocaleDateString("en-AU", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
        : "Invalid Date";

      return {
        id: b.id,
        name: b.name,
        email: b.email,
        service: b.service,
        date,
        time,
        created_at: createdDate,
      };
    });

    return {
      statusCode: 200,
      body: JSON.stringify(formatted),
    };
  } catch (error) {
    console.error("Error fetching bookings:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
