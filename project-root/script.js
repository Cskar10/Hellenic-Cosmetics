document.getElementById("bookingForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  
  const formData = {
    name: this.name.value,
    email: this.email.value,
    date: this.date.value,
    service: this.service.value
  };

  const response = await fetch("/.netlify/functions/booking", {
    method: "POST",
    body: JSON.stringify(formData)
  });

  if (response.ok) {
    document.getElementById("bookingMessage").classList.remove("hidden");
    this.reset();
  } else {
    alert("Something went wrong. Try again.");
  }
});
