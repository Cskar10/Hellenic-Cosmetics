const { Client } = require('pg');

exports.handler = async (event) => {
  try {
    const data = JSON.parse(event.body);

    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();

    const query = `
      INSERT INTO bookings (name, email, service, appointment_date)
      VALUES ($1, $2, $3, $4) RETURNING id
    `;
    const values = [data.name, data.email, data.service, data.date];

    const result = await client.query(query, values);
    await client.end();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Booking saved with ID: ${result.rows[0].id}`
      })
    };
  } catch (error) {
    console.error("Booking insert error:", error);
    return { statusCode: 500, body: "Error saving booking." };
  }
};
