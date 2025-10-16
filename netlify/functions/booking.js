const { Client } = require("pg");

exports.handler = async (event) => {
  console.log("Incoming booking request:", event.body);

  try {
    const data = JSON.parse(event.body);
    const { name, email, date, time, service } = data;

    if (!name || !email || !date || !time || !service) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields." }),
      };
    }

    console.info("Parsed Date/Time Input:");
    console.info(`  Date: ${date}`);
    console.info(`  Time: ${time}`);

    // --- Step 1: Parse user input ---
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);

    // --- Step 2: Build UTC equivalent manually ---
    // Determine Melbourne offset (DST-aware)
    const melOffsetHours = getMelbourneOffset(year, month, day);
    console.info(`  DST-adjusted Melbourne offset: +${melOffsetHours}h`);

    // Melbourne local time (for DB display)
    const melbourneLocal = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const melbourneForDB = melbourneLocal.toISOString().slice(0, 19).replace("T", " ");

    // Compute UTC version by subtracting the offset
    const utcMillis = melbourneLocal.getTime() - melOffsetHours * 60 * 60 * 1000;
    const utcDate = new Date(utcMillis);
    const utcForDB = utcDate.toISOString();

    console.info("Final Computed Values:");
    console.info("  Melbourne Local:", melbourneForDB);
    console.info("  UTC ISO:", utcForDB);

    // --- Step 3: Connect to PostgreSQL ---
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
    console.info("Connected to database.");

    // --- Step 4: Insert booking ---
    const insertQuery = `
      INSERT INTO bookings 
        (name, email, service, appointment_datetime_local, appointment_datetime_utc, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *;
    `;

    const values = [name, email, service, melbourneForDB, utcForDB];
    const result = await client.query(insertQuery, values);
    const booking = result.rows[0];

    await client.end();
    console.info("Booking inserted successfully:", booking);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Booking successfully created!",
        booking,
      }),
    };
  } catch (error) {
    console.error("Booking error details:", error);

    if (error.code === "23505") {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "You already have a booking at this time.",
        }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Something went wrong while processing your booking.",
        details: error.message,
      }),
    };
  }
};

// --- Helper: Get DST-aware Melbourne offset (hours) ---
function getMelbourneOffset(year, month, day) {
  // Approx DST: from first Sunday of October to first Sunday of April
  const date = new Date(Date.UTC(year, month - 1, day));
  const dstStart = getFirstSunday(year, 10); // October
  const dstEnd = getFirstSunday(year + (month < 4 ? 0 : 1), 4); // April next year if past March

  const isDST = date >= dstStart || date < dstEnd;
  return isDST ? 11 : 10;
}

// Helper to get the first Sunday of a given month/year (UTC)
function getFirstSunday(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
