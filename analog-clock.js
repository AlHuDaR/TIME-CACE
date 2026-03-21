(function (global) {
  const { OMAN_ANALOG_PARTS_FORMATTER } = global.RAFOTimeApp || {};
  const CLOCK_LOGO_PATH = "images/cal logo.png";
  let analogClockInstanceCount = 0;

  if (!OMAN_ANALOG_PARTS_FORMATTER) {
    throw new Error("OMAN_ANALOG_PARTS_FORMATTER is unavailable. Ensure api-client.js loads before analog-clock.js.");
  }

  function buildPtbAnalogClock(svg) {
    if (!svg) {
      throw new Error("PTB analog clock SVG element is required.");
    }

    const ns = "http://www.w3.org/2000/svg";
    const make = (tag, attrs = {}) => {
      const el = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
      return el;
    };
    const instanceToken = `${(svg.id || "ptbClockSvg").replace(/[^a-zA-Z0-9_-]/g, "") || "ptbClockSvg"}-${analogClockInstanceCount += 1}`;
    const logoShadowId = `${instanceToken}-logoShadow`;

    svg.replaceChildren();

    const defs = make("defs");
    const logoShadow = make("filter", { id: logoShadowId, x: "-40%", y: "-40%", width: "180%", height: "180%" });
    logoShadow.append(make("feDropShadow", { dx: "1.4", dy: "1.6", stdDeviation: "2", "flood-color": "#0f4358", "flood-opacity": "0.55" }));
    defs.append(logoShadow);
    svg.append(defs);

    svg.append(make("rect", { x: 0, y: 0, width: 800, height: 800, fill: "#e8e8e8" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 380, fill: "none", stroke: "#1a6b8c", "stroke-width": 6 }));

    const tickGroup = make("g", { id: "ticks" });
    for (let i = 0; i < 60; i += 1) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const isHour = i % 5 === 0;
      const outerRadius = 370;
      const length = isHour ? 25 : 15;
      const innerRadius = outerRadius - length;
      const x1 = 400 + innerRadius * Math.cos(angle);
      const y1 = 400 + innerRadius * Math.sin(angle);
      const x2 = 400 + outerRadius * Math.cos(angle);
      const y2 = 400 + outerRadius * Math.sin(angle);
      tickGroup.append(make("line", {
        x1: x1.toFixed(3),
        y1: y1.toFixed(3),
        x2: x2.toFixed(3),
        y2: y2.toFixed(3),
        stroke: isHour ? "#1a6b8c" : "#2a7a98",
        "stroke-width": isHour ? 8 : 4,
        "stroke-linecap": "round",
      }));
    }
    svg.append(tickGroup);

    const numbers = make("g", { id: "numbers", fill: "#1a6b8c", "font-family": "Arial, Helvetica, sans-serif", "font-size": 60, "text-anchor": "middle", "dominant-baseline": "middle" });
    for (let i = 1; i <= 12; i += 1) {
      const angle = ((i * 30 - 90) * Math.PI) / 180;
      const x = 400 + 300 * Math.cos(angle);
      const y = 400 + 300 * Math.sin(angle);
      const text = make("text", { x: x.toFixed(3), y: y.toFixed(3) });
      text.textContent = String(i);
      numbers.append(text);
    }
    svg.append(numbers);

    const dateText = make("text", { x: 400, y: 160, fill: "#1a6b8c", "font-size": 26, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    dateText.textContent = "06.03.2026";
    svg.append(dateText);

    const timeText = make("text", { x: 400, y: 655, fill: "#1a6b8c", "font-size": 25, "font-weight": 700, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle" });
    timeText.textContent = "01:36:21";
    svg.append(timeText);

    const tzText = make("text", { x: 400, y: 560, fill: "#1a6b8c", "font-size": 17, "font-family": "Arial, Helvetica, sans-serif", "text-anchor": "middle", "font-weight": "bold" });
    tzText.textContent = "MCT (UTC+04:00)";
    svg.append(tzText);

    const centerX = 400;
    const centerY = 400;
    const clockRadius = 380;
    const logoSize = clockRadius * 1.23;
    const centerLogoGroup = make("g", {
      id: `${instanceToken}-centerBrand`,
      opacity: 0.46,
      "pointer-events": "none",
    });
    const centerLogo = make("image", {
      id: `${instanceToken}-centerLogo`,
      href: CLOCK_LOGO_PATH,
      x: centerX - (logoSize / 2),
      y: centerY - (logoSize / 2),
      width: logoSize,
      height: logoSize,
      preserveAspectRatio: "xMidYMid meet",
      filter: `url(#${logoShadowId})`,
    });
    centerLogo.setAttributeNS("http://www.w3.org/1999/xlink", "href", CLOCK_LOGO_PATH);
    centerLogoGroup.append(centerLogo);
    svg.append(centerLogoGroup);

    const handsGroup = make("g", { id: "hands" });
    const hourHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 230, stroke: "#1a6b8c", "stroke-width": 14, "stroke-linecap": "round", opacity: 0.86 });
    const minuteHand = make("line", { x1: 400, y1: 400, x2: 400, y2: 170, stroke: "#1f7699", "stroke-width": 10, "stroke-linecap": "round", opacity: 0.84 });
    const secondHandGroup = make("g");
    const secondHand = make("line", { x1: 400, y1: 435, x2: 400, y2: 140, stroke: "#d32f2f", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.94 });
    const counterWeight = make("circle", { cx: 400, cy: 420, r: 10, fill: "#d32f2f" });
    secondHandGroup.append(secondHand, counterWeight);
    handsGroup.append(hourHand, minuteHand, secondHandGroup);
    svg.append(handsGroup);

    svg.append(make("circle", { cx: 400, cy: 400, r: 15, fill: "#d32f2f" }));
    svg.append(make("circle", { cx: 400, cy: 400, r: 5, fill: "#ffffff" }));

    return {
      hourHand,
      minuteHand,
      secondHand,
      secondHandGroup,
      analogDateText: dateText,
      analogTimeText: timeText,
      analogTimeZoneText: tzText,
    };
  }

  function getOmanAnalogParts(now) {
    const parts = OMAN_ANALOG_PARTS_FORMATTER.formatToParts(now);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      hour: Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
      date: `${map.day}.${map.month}.${map.year}`,
    };
  }

  global.RAFOTimeApp = global.RAFOTimeApp || {};
  Object.assign(global.RAFOTimeApp, {
    buildPtbAnalogClock,
    getOmanAnalogParts,
  });
})(window);
