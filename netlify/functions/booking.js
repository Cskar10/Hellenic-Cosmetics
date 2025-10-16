const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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
    const melOffsetHours = getMelbourneOffset(year, month, day);
    console.info(`  DST-adjusted Melbourne offset: +${melOffsetHours}h`);

    const melbourneLocal = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const melbourneForDB = melbourneLocal.toISOString().slice(0, 19).replace("T", " ");
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

    // --- Step 4: Insert booking record (optional future use) ---
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

    // --- Step 5: Build Calendar (ICS) Attachment ---
    const icsContent = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hellenic Cosmetics//EN
BEGIN:VEVENT
UID:${booking.id}@hellenic-cosmetics.com
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z
DTSTART;TZID=Australia/Melbourne:${date.replace(/-/g, "")}T${time.replace(":", "")}00
SUMMARY:${service}
DESCRIPTION:Appointment Enquiry at Hellenic Cosmetics
END:VEVENT
END:VCALENDAR
`;

    // --- Step 6: Send Email Confirmation ---
    const adminEmail = process.env.ADMIN_EMAIL;

    const formattedDate = new Date(date).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const policyText = `
Future Bookings Policy:
- A non-refundable deposit is required to secure your booking.
- Appointments may be rescheduled once with 48 hours' notice.
- Cancellations within 48 hours or no-shows forfeit the deposit.
- Please arrive on time. Arrivals more than 10 minutes late may be rescheduled.
- Frequent last-minute changes may affect future booking availability.
`;

    const msg = {
      to: email,
      cc: adminEmail,
      from: {
        email: adminEmail,
        name: "Hellenic Cosmetics",
      },
      subject: `Your Appointment Enquiry – ${service}`,
      text: `Dear ${name},

Thank you for your appointment enquiry with Hellenic Cosmetics.

📅 Requested Date: ${formattedDate}
🕒 Requested Time: ${time}
💆 Service: ${service}

Your enquiry has been received. Our team will contact you shortly to confirm availability.

${policyText}

Warm regards,
Hellenic Cosmetics
`,
      attachments: [
        {
          content: Buffer.from(icsContent).toString("base64"),
          filename: "appointment.ics",
          type: "text/calendar",
          disposition: "attachment",
        },
      ],
    };

    await sgMail.send(msg);
    console.info("Enquiry email sent successfully to client and admin.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Enquiry submitted and email sent successfully!",
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
  const date = new Date(Date.UTC(year, month - 1, day));
  const dstStart = getFirstSunday(year, 10); // October
  const dstEnd = getFirstSunday(year + (month < 4 ? 0 : 1), 4); // April next year if past March
  const isDST = date >= dstStart || date < dstEnd;
  return isDST ? 11 : 10;
}

function getFirstSunday(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
