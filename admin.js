// Wait until both DOM and Netlify Identity are ready
function initAdminDashboard() {
  const loginSection = document.getElementById("login-section");
  const dashboardSection = document.getElementById("dashboard-section");
  const loginButton = document.getElementById("login-button");
  const tableBody = document.getElementById("bookings-table");

  if (!window.netlifyIdentity) {
    console.warn("Netlify Identity not ready yet, retrying...");
    setTimeout(initAdminDashboard, 200);
    return;
  }

  // --- AUTH FLOW ---
  window.netlifyIdentity.on("init", (user) => {
    if (user) showDashboard(user);
    else showLogin();
  });

  loginButton.addEventListener("click", () => {
    window.netlifyIdentity.open("login");
  });

  window.netlifyIdentity.on("login", (user) => {
    window.netlifyIdentity.close();
    showDashboard(user);
  });

  window.netlifyIdentity.on("logout", () => {
    showLogin();
  });

  function showLogin() {
    loginSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
  }

  function showDashboard(user) {
    loginSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    loadBookings(user.token.access_token);
  }

  // --- LOAD BOOKINGS ---
  async function loadBookings(token) {
    tableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-gray-500">Loading...</td></tr>`;

    try {
      const res = await fetch("/.netlify/functions/getBookings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const bookings = await res.json();

      if (!bookings || bookings.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-gray-500">No bookings found.</td></tr>`;
        return;
      }

      // Render table rows
      tableBody.innerHTML = bookings
        .map((b) => {
          let date = "Invalid Date";
          let time = "Invalid Time";

          // Safely parse "YYYY-MM-DD HH:mm:ss"
          if (b.date && b.time === undefined && b.appointment_datetime_local) {
            const parts = b.appointment_datetime_local.split(" ");
            if (parts.length === 2) {
              const [d, t] = parts;
              const parsed = new Date(`${d}T${t}`);
              if (!isNaN(parsed)) {
                date = parsed.toLocaleDateString("en-AU", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                });
                time = parsed.toLocaleTimeString("en-AU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
              }
            }
          } else if (b.date && b.time) {
            // Already formatted by getBookings.js
            date = b.date;
            time = b.time;
          }

          const created = new Date(b.created_at).toLocaleDateString("en-AU");

          return `
            <tr>
              <td class="border px-3 py-2">${b.id}</td>
              <td class="border px-3 py-2">${b.name}</td>
              <td class="border px-3 py-2">${b.email}</td>
              <td class="border px-3 py-2">${b.service}</td>
              <td class="border px-3 py-2">${date}</td>
              <td class="border px-3 py-2">${time}</td>
              <td class="border px-3 py-2">${created}</td>
              <td class="border px-3 py-2">
                <button data-id="${b.id}" class="delete-btn bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">
                  Delete
                </button>
              </td>
            </tr>
          `;
        })
        .join("");

      // Wire up delete buttons
      document.querySelectorAll(".delete-btn").forEach((btn) =>
        btn.addEventListener("click", () => deleteBooking(btn.dataset.id, token))
      );
    } catch (err) {
      console.error("Error loading bookings:", err);
      tableBody.innerHTML = `<tr><td colspan="8" class="p-4 text-red-600">Error loading bookings.</td></tr>`;
    }
  }

  // --- DELETE BOOKING ---
  async function deleteBooking(id, token) {
    if (!confirm("Delete this booking?")) return;
    try {
      const res = await fetch("/.netlify/functions/deleteBooking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      alert("Deleted successfully");
      loadBookings(token);
    } catch (err) {
      alert("Error deleting booking: " + err.message);
      console.error(err);
    }
  }
}

document.addEventListener("DOMContentLoaded", initAdminDashboard);
