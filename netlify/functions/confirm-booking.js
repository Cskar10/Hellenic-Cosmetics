const { Client } = require("pg");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

exports.handler = async (event) => {
  try {
    const { id, action, newDate, newTime } = JSON.parse(event.body);

    const client = new Client({
      host: process.env.PGHOST,
      port: process.env.PGPORT,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    // Fetch existing booking
    const result = await client.query("SELECT * FROM bookings WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      await client.end();
      return { statusCode: 404, body: JSON.stringify({ error: "Booking not found" }) };
    }

    let booking = result.rows[0];

    // If "change", update date/time
    if (action === "change") {
      if (!newDate || !newTime) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing new date/time" }) };
      }

      await client.query(
        `UPDATE bookings SET appointment_datetime_local=$1 WHERE id=$2`,
        [`${newDate} ${newTime}:00`, id]
      );
      booking.appointment_datetime_local = `${newDate} ${newTime}:00`;
    }

    await client.end();

    // Build ICS calendar invite
    const icsContent = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Hellenic Cosmetics//EN
BEGIN:VEVENT
UID:${booking.id}@hellenic-cosmetics.com
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z
DTSTART;TZID=Australia/Melbourne:${booking.appointment_datetime_local.replace(/[-: ]/g, "").slice(0, 13)}00
SUMMARY:Confirmed Appointment - ${booking.service}
DESCRIPTION:Your appointment at Hellenic Cosmetics is confirmed.
END:VEVENT
END:VCALENDAR
`;

    const formattedDate = new Date(
      booking.appointment_datetime_local.split(" ")[0]
    ).toLocaleDateString("en-AU", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const msg = {
      to: booking.email,
      from: { email: "bookings@hellenic-cosmetics.com", name: "Hellenic Cosmetics" },
      subject: "Your Appointment is Confirmed",
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
          <p>Dear ${booking.name},</p>

          <p>We are pleased to confirm your appointment with <strong>Hellenic Cosmetics</strong>.</p>

          <p><strong>📅 Date:</strong> ${formattedDate}<br>
          <strong>🕒 Time:</strong> ${booking.appointment_datetime_local.split(" ")[1]}<br>
          <strong>💆 Service:</strong> ${booking.service}</p>

          <p>Your appointment has been confirmed. Please find your calendar invite attached.</p>

          <hr style="margin: 25px 0;">

          <h3 style="color: #b8926a;">Future Bookings Policy</h3>

          <p>
            • A non-refundable deposit is required to secure your booking.<br>
            • Appointments may be rescheduled once with 48 hours' notice.<br>
            • Cancellations within 48 hours or no-shows forfeit the deposit.<br>
            • Please arrive on time. Late arrivals may need rescheduling.<br>
            • Frequent last-minute changes may affect future booking availability.
          </p>

          <hr style="margin: 25px 0;">

          <p style="text-align: center; color: red; font-weight: bold;">
            ⚠️ This email confirms your appointment.
          </p>

          <p>We look forward to welcoming you at our Melbourne studio.<br>
          Please don’t hesitate to reply to this email if you have any questions.</p>

          <p><strong>Warm regards,</strong><br>
          <strong>Hellenic Cosmetics</strong></p>
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
      body: JSON.stringify({ error: "Failed to confirm booking", details: err.message }),
    };
  }
};
