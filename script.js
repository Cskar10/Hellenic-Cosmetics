document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const messageEl = document.getElementById("bookingMessage");

  // Reset message state
  messageEl.textContent = "";
  messageEl.classList.add("hidden");

  if (submitBtn.disabled) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Sending...";

  const bookingData = {
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    date: form.date.value,
    time: form.time.value,
    service: form.service.value,
  };
  
  // --- Time validation (must be between 5pm–9pm) ---
  const [hour, minute] = form.time.value.split(":").map(Number);
  if (hour < 17 || hour >= 21) {
    messageEl.textContent = "Bookings are only available between 5:00 PM and 9:00 PM.";
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
    return; // stop submission
  }

  try {
    const response = await fetch("/.netlify/functions/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingData),
    });

    const result = await response.json();

    if (!response.ok) {
      // Handle specific validation errors from backend
      let message = result.error || "An error occurred. Please try again.";
      
      if (message.includes("48 hours")) {
        message = "Bookings must be made at least 48 hours in advance.";
      } else if (message.includes("5:00 PM") || message.includes("9:00 PM")) {
        message = "Bookings are only available between 5:00 PM and 9:00 PM.";
      }

      messageEl.textContent = message;
      messageEl.classList.remove("hidden", "text-green-600");
      messageEl.classList.add("text-red-600");
      return;
    }

    // Success
    messageEl.textContent = "Thank you! Your appointment enquiry has been submitted successfully.";
    messageEl.classList.remove("hidden", "text-red-600");
    messageEl.classList.add("text-green-600");

    // Reset form and refresh page after short delay
    form.reset();
    setTimeout(() => location.reload(), 1500);

  } catch (err) {
    console.error(err);
    messageEl.textContent = "Something went wrong. Please try again.";
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
});
