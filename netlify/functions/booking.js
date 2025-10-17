const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");

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

    // Step 1: Parse date/time
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);

    // Step 2: Correct Melbourne-local time calculation
    const melOffsetHours = getMelbourneOffset(year, month, day);
    console.info(`  DST-adjusted Melbourne offset: +${melOffsetHours}h`);

    // Construct Melbourne-local time correctly
    const melbourneLocal = new Date(year, month - 1, day, hour, minute);
    const utcMillis = melbourneLocal.getTime() - melOffsetHours * 60 * 60 * 1000;
    const utcDate = new Date(utcMillis);

    const melbourneForDB = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0"
    )}:00`;
    const utcForDB = utcDate.toISOString();

    // Rule 1: 48-hour minimum notice
    const nowMelbourne = new Date(
      new Date().getTime() + melOffsetHours * 60 * 60 * 1000
    );
    const hoursDifference = (melbourneLocal - nowMelbourne) / (1000 * 60 * 60);
    if (hoursDifference <= 48) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error:
            "Appointments must be booked at least 48 hours in advance. Please select a later date.",
        }),
      };
    }

    // Rule 2: Booking between 5pm–9pm
    if (hour < 17 || hour >= 21) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Bookings are only available between 5:00 PM and 9:00 PM.",
        }),
      };
    }

    // Step 3: Connect to PostgreSQL
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();
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

    // Step 4: Email notification
    const adminEmail = process.env.ADMIN_EMAIL;
    const formattedDate = new Date(date).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const policyText = `
Future Bookings Policy:
• A non-refundable deposit is required to secure your booking.
• Appointments may be rescheduled once with 48 hours' notice.
• Cancellations within 48 hours or no-shows forfeit the deposit.
• Please arrive on time. Late arrivals may need rescheduling.
• Frequent last-minute changes may affect future booking availability.
`;

    const msg = {
      to: email,
      cc: adminEmail,
      from: { email: adminEmail, name: "Hellenic Cosmetics" },
      subject: `Your Appointment Enquiry – ${service}`,
      text: `Dear ${name},

Thank you for your appointment enquiry with Hellenic Cosmetics.

📅 Requested Date: ${formattedDate}
🕒 Requested Time: ${time}
💆 Service: ${service}

Your enquiry has been received. Our team will contact you shortly to confirm availability.

${policyText}

⚠️ IMPORTANT:
This email is NOT a booking confirmation.
You will receive a separate confirmation within the next 48 hours.

We look forward to welcoming you at our Melbourne studio.
Please don’t hesitate to reply to this email if you have any questions.

Warm regards,
Hellenic Cosmetics
`,
      html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #3a2e24; background-color: #f8f5f2; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
        <h2 style="color: #b8926a; text-align: center;">Appointment Enquiry</h2>
        <p>Dear ${name},</p>
        <p>Thank you for your appointment enquiry with <strong>Hellenic Cosmetics</strong>.</p>
        <div style="background-color: #fff; padding: 15px; border-radius: 10px; box-shadow: 0 0 8px rgba(0,0,0,0.05); margin: 20px 0;">
          <p><strong>📅 Requested Date:</strong> ${formattedDate}</p>
          <p><strong>🕒 Requested Time:</strong> ${time}</p>
          <p><strong>💆 Service:</strong> ${service}</p>
        </div>
        <h3 style="color: #b8926a;">Future Bookings Policy</h3>
        <pre style="white-space: pre-line; font-family: inherit;">${policyText}</pre>
        <p style="color: red; text-align: center; font-weight: bold;">
          ⚠️ This email is NOT a booking confirmation.<br>
          You will receive a confirmation within 48 hours.
        </p>
        <p>We look forward to welcoming you at our Melbourne studio.<br>
        Please don’t hesitate to reply to this email if you have any questions.</p>
        <p style="font-weight: bold; color: #b8926a;">Warm regards,<br>Hellenic Cosmetics</p>
      </div>`,
    };

    await sgMail.send(msg);
    console.info("Enquiry email sent successfully.");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Enquiry submitted successfully! Email sent to client and admin.",
        booking,
      }),
    };
  } catch (error) {
    console.error("Booking error details:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Something went wrong while processing your booking.",
        details: error.message,
      }),
    };
  }
};

// --- Helper: DST-aware Melbourne offset ---
function getMelbourneOffset(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dstStart = getFirstSunday(year, 10);
  const dstEnd = getFirstSunday(year + (month < 4 ? 0 : 1), 4);
  const isDST = date >= dstStart || date < dstEnd;
  return isDST ? 11 : 10;
}

function getFirstSunday(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
