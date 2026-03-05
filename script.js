const ticksContainer = document.getElementById("ticks");
const numbersContainer = document.getElementById("numbers");
const hourHand = document.getElementById("hourHand");
const minuteHand = document.getElementById("minuteHand");
const secondHand = document.getElementById("secondHand");
const dateText = document.getElementById("dateText");
const timeText = document.getElementById("timeText");
const zoneText = document.getElementById("zoneText");

function buildDial() {
  for (let minute = 0; minute < 60; minute += 1) {
    const tick = document.createElement("span");
    tick.className = `tick ${minute % 5 === 0 ? "major" : "minor"}`;
    tick.style.transform = `translate(-50%, -50%) rotate(${minute * 6}deg) translateY(calc(-50% + -44%))`;
    ticksContainer.appendChild(tick);
  }

  for (let number = 1; number <= 12; number += 1) {
    const el = document.createElement("span");
    el.className = "number";
    const angle = (number * 30 - 90) * (Math.PI / 180);
    const radius = 40;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.textContent = String(number);
    numbersContainer.appendChild(el);
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function getOffsetLabel(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `UTC${sign}${hh}:${mm}`;
}

function updateClock() {
  const now = new Date();

  const milliseconds = now.getMilliseconds();
  const seconds = now.getSeconds() + milliseconds / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;

  hourHand.style.transform = `translate(-50%, -100%) rotate(${hours * 30}deg)`;
  minuteHand.style.transform = `translate(-50%, -100%) rotate(${minutes * 6}deg)`;
  secondHand.style.transform = `translate(-50%, -100%) rotate(${seconds * 6}deg)`;

  dateText.textContent = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  timeText.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const zoneName = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName")?.value;
  zoneText.textContent = `${zoneName || "LOCAL"} (${getOffsetLabel(now)})`;

  requestAnimationFrame(updateClock);
}

buildDial();
updateClock();
