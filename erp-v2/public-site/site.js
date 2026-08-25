"use strict";

const form = document.getElementById("trialForm");
const errorBox = document.getElementById("trialError");
const moduleInputs = [...form.querySelectorAll('input[name="modules"]')];

form.elements.organizationCode.addEventListener("input", event => {
  event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-");
});
form.elements.username.addEventListener("input", event => {
  event.target.value = event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "");
});
moduleInputs.forEach(input => input.addEventListener("change", event => {
  if (moduleInputs.filter(item => item.checked).length > 6) {
    event.target.checked = false;
    errorBox.textContent = "6 хүртэл модуль сонгоно уу.";
  } else errorBox.textContent = "";
}));

form.addEventListener("submit", async event => {
  event.preventDefault();
  errorBox.textContent = "";
  if (!form.reportValidity()) return;
  const button = form.querySelector("button[type=submit]");
  const values = Object.fromEntries(new FormData(form));
  values.modules = moduleInputs.filter(input => input.checked).map(input => input.value);
  values.acceptedTerms = form.elements.acceptedTerms.checked;
  button.disabled = true;
  button.textContent = "Орчин үүсгэж байна…";
  try {
    const response = await fetch("/api/public/trials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Trial орчин үүсгэж чадсангүй.");
    document.getElementById("successName").textContent = result.organization.name;
    document.getElementById("successCode").textContent = result.organization.code;
    document.getElementById("successOwner").textContent = `Хэрэглэгч: ${result.owner.username} · Дуусах: ${new Date(result.trial.endsAt).toLocaleDateString("mn-MN")}`;
    document.getElementById("successLogin").href = `https://app.overva.com/?organization=${encodeURIComponent(result.organization.code)}&identifier=${encodeURIComponent(result.owner.username)}`;
    form.classList.add("hidden");
    document.getElementById("trialSuccess").classList.remove("hidden");
  } catch (error) {
    errorBox.textContent = error.message;
    button.disabled = false;
    button.textContent = "Trial орчин үүсгэх";
  }
});
