document.getElementById("bookingForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const submitBtn = form.querySelector("button[type='submit']");
  const messageEl = document.getElementById("bookingMessage");

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

  try {
    const response = await fetch("/.netlify/functions/booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingData),
    });

    const result = await response.json();

    if (!response.ok) {
      const message = result.error || "Error submitting booking.";
      alert(message);
      throw new Error(message);
    }

    messageEl.textContent = "Booking request sent successfully!";
    messageEl.classList.remove("hidden", "text-red-600");
    messageEl.classList.add("text-green-600");
    form.reset();
  } catch (err) {
    console.error(err);
    messageEl.textContent = err.message || "Something went wrong. Please try again.";
    messageEl.classList.remove("hidden", "text-green-600");
    messageEl.classList.add("text-red-600");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
});
