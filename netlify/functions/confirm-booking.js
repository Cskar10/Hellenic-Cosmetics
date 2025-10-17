const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  try {
    const { id, action, newDate, newTime } = JSON.parse(event.body);

    // --- Connect to Database ---
    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    // --- Fetch Booking ---
    const result = await client.query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      await client.end();
      return { statusCode: 404, body: JSON.stringify({ error: "Booking not found" }) };
    }

    let booking = result.rows[0];

    // --- If "change", update date/time ---
    if (action === "change") {
      if (!newDate || !newTime) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing new date/time" }) };
      }

      const [year, month, day] = newDate.split("-").map(Number);
      const [hour, minute] = newTime.split(":").map(Number);
      const melOffset = getMelbourneOffset(year, month, day);
      const melbourneLocal = new Date(year, month - 1, day, hour, minute);
      const utcMillis = melbourneLocal.getTime() - melOffset * 60 * 60 * 1000;
      const utcDate = new Date(utcMillis);
      const utcForDB = utcDate.toISOString();
      const melbourneLocalStr = `${newDate} ${newTime}:00`;

      await client.query(
        `UPDATE bookings SET appointment_datetime_local=$1, appointment_datetime_utc=$2 WHERE id=$3`,
        [melbourneLocalStr, utcForDB, id]
      );

      booking.appointment_datetime_local = melbourneLocalStr;
      booking.appointment_datetime_utc = utcForDB;
    }

    await client.end();

    // --- ICS Attachment ---
    const dtStart = booking.appointment_datetime_local.replace(/[-: ]/g, "").slice(0, 15);
    const icsContent = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hellenic Cosmetics//EN
BEGIN:VEVENT
UID:${booking.id}@hellenic-cosmetics.com
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z
DTSTART;TZID=Australia/Melbourne:${dtStart}
SUMMARY:Confirmed Appointment - ${booking.service}
DESCRIPTION:Your appointment at Hellenic Cosmetics is confirmed.
END:VEVENT
END:VCALENDAR
`;

    // --- Email Composition ---
    const adminEmail = process.env.ADMIN_EMAIL;
    const fromEmail = process.env.FROM_EMAIL || adminEmail;

    const [date, time] = booking.appointment_datetime_local.split(" ");
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
      to: booking.email,
      cc: adminEmail,
      from: { email: fromEmail, name: "Hellenic Cosmetics" },
      subject: "Your Appointment Has Been Confirmed – Hellenic Cosmetics",
      text: `Dear ${booking.name},

Your appointment at Hellenic Cosmetics has been confirmed.

📅 Date: ${formattedDate}
🕒 Time: ${time}
💆 Service: ${booking.service}

${policyText}

We look forward to welcoming you at our Melbourne studio. 
Please don’t hesitate to reply to this email if you have any questions.

Warm regards,
Hellenic Cosmetics
`,
      html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; color: #3a2e24; background-color: #f8f5f2; padding: 30px; border-radius: 12px; max-width: 600px; margin: auto;">
        <h2 style="color: #b8926a; text-align: center; letter-spacing: 1px;">Appointment Confirmation</h2>

        <p>Dear ${booking.name},</p>

        <p>We are pleased to confirm your appointment with <strong>Hellenic Cosmetics</strong>.</p>

        <div style="background-color: #fff; padding: 15px; border-radius: 10px; box-shadow: 0 0 8px rgba(0,0,0,0.05); margin: 20px 0;">
          <p><strong>📅 Date:</strong> ${formattedDate}</p>
          <p><strong>🕒 Time:</strong> ${time}</p>
          <p><strong>💆 Service:</strong> ${booking.service}</p>
        </div>

        <hr style="margin: 25px 0; border: none; border-top: 1px solid #e5ded8;">

        <h3 style="color: #b8926a; font-size: 18px;">Future Bookings Policy</h3>
        <pre style="white-space: pre-line; font-family: inherit; background-color: #fff; padding: 15px; border-radius: 8px; border: 1px solid #eee; line-height: 1.5;">
${policyText}
        </pre>

        <hr style="margin: 25px 0; border: none; border-top: 1px solid #e5ded8;">

        <p style="text-align: center; font-weight: bold; color: red; font-size: 1.1em;">
          ⚠️ This email confirms your appointment.
        </p>

        <p style="margin-top: 25px;">
          We look forward to welcoming you at our Melbourne studio.<br>
          Please don’t hesitate to reply to this email if you have any questions.
        </p>

        <p style="font-weight: bold; color: #b8926a;">Warm regards,<br>Hellenic Cosmetics</p>
      </div>
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:
          action === "change"
            ? "Booking updated and confirmation email sent."
            : "Booking accepted and confirmation email sent.",
      }),
    };
  } catch (err) {
    console.error("Confirm booking error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to confirm booking",
        details: err.message,
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
