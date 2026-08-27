(() => {
  "use strict";

  const VISITOR_WEATHER_URL = "/api/visitor-weather";
  const SYDNEY_WEATHER_URL =
    "https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=Australia%2FSydney&forecast_days=1";
  const CACHE_KEY = "aden-visitor-weather-v2";
  const CACHE_TTL = 10 * 60 * 1000;
  const FALLBACK_LOCATION = {
    label: "悉尼",
    city: "Sydney",
    region: "NSW",
    country: "AU",
    timezone: "Australia/Sydney",
    source: "fallback",
    approximate: true
  };

  let clockTimer = null;
  let swupBound = false;
  let activeTimeZone = FALLBACK_LOCATION.timezone;
  let timeFormatter = createTimeFormatter(activeTimeZone);
  let dateFormatter = createDateFormatter(activeTimeZone);

  const weatherCodes = {
    0: ["晴朗", "SUN", "☀"],
    1: ["大致晴朗", "CLEAR", "◒"],
    2: ["局部多云", "CLOUD", "◑"],
    3: ["阴天", "OVERCAST", "☁"],
    45: ["有雾", "FOG", "≋"],
    48: ["雾凇", "RIME", "≋"],
    51: ["小毛毛雨", "DRIZZLE", "⋰"],
    53: ["毛毛雨", "DRIZZLE", "⋰"],
    55: ["较强毛毛雨", "DRIZZLE", "⋰"],
    56: ["冻毛毛雨", "ICE RAIN", "❄"],
    57: ["较强冻毛毛雨", "ICE RAIN", "❄"],
    61: ["小雨", "RAIN", "⌁"],
    63: ["中雨", "RAIN", "⌁"],
    65: ["大雨", "HEAVY RAIN", "⌁"],
    66: ["冻雨", "ICE RAIN", "❄"],
    67: ["较强冻雨", "ICE RAIN", "❄"],
    71: ["小雪", "SNOW", "✦"],
    73: ["中雪", "SNOW", "✦"],
    75: ["大雪", "HEAVY SNOW", "✦"],
    77: ["米雪", "SNOW", "✦"],
    80: ["局部阵雨", "SHOWERS", "⌁"],
    81: ["阵雨", "SHOWERS", "⌁"],
    82: ["强阵雨", "SHOWERS", "⌁"],
    85: ["阵雪", "SNOW", "✦"],
    86: ["强阵雪", "SNOW", "✦"],
    95: ["雷暴", "STORM", "ϟ"],
    96: ["雷暴伴冰雹", "STORM", "ϟ"],
    99: ["强雷暴伴冰雹", "STORM", "ϟ"]
  };

  function createTimeFormatter(timeZone) {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  }

  function createDateFormatter(timeZone) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });
  }

  function isValidTimeZone(timeZone) {
    if (!timeZone) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
      return true;
    } catch (_) {
      return false;
    }
  }

  function getTimeZoneName(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-AU", {
        timeZone,
        timeZoneName: "short"
      }).formatToParts(new Date());
      return parts.find((part) => part.type === "timeZoneName")?.value || timeZone;
    } catch (_) {
      return timeZone;
    }
  }

  function createCard() {
    const card = document.createElement("section");
    card.className = "cyber-weather-card";
    card.id = "visitor-status-hud";
    card.setAttribute("aria-label", "访客所在地时间与天气");
    card.innerHTML = `
      <div class="cyber-weather-header">
        <span class="cyber-weather-live"><i aria-hidden="true"></i> LIVE // <span data-location="name">LOCATING</span></span>
        <span class="cyber-weather-coords" data-location="timezone">LOCAL NODE</span>
      </div>
      <div class="cyber-weather-grid">
        <div class="cyber-clock-block">
          <span class="cyber-data-label" data-location="clock-label">LOCAL TIME / CALIBRATING</span>
          <time class="cyber-clock" datetime="">--:--:--</time>
          <span class="cyber-date">正在校准时间…</span>
        </div>
        <div class="cyber-current-weather" aria-live="polite">
          <span class="cyber-weather-icon" aria-hidden="true">◌</span>
          <div>
            <span class="cyber-temperature">--°</span>
            <span class="cyber-condition">正在识别访客地区…</span>
            <span class="cyber-feels-like">体感温度 --°C</span>
          </div>
        </div>
        <dl class="cyber-weather-metrics">
          <div><dt>HUMIDITY</dt><dd data-weather="humidity">--%</dd></div>
          <div><dt>WIND</dt><dd data-weather="wind">-- km/h</dd></div>
          <div><dt>SUNSET</dt><dd data-weather="sunset">--:--</dd></div>
        </dl>
      </div>
      <div class="cyber-weather-footer">
        <span data-weather="status">LOCATION LINK / CONNECTING</span>
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">DATA / OPEN-METEO</a>
      </div>`;
    return card;
  }

  function applyLocation(card, location = FALLBACK_LOCATION) {
    const timeZone = isValidTimeZone(location.timezone) ? location.timezone : FALLBACK_LOCATION.timezone;
    const label = String(location.label || location.city || location.region || location.country || "当前位置");
    activeTimeZone = timeZone;
    timeFormatter = createTimeFormatter(activeTimeZone);
    dateFormatter = createDateFormatter(activeTimeZone);

    card.querySelector('[data-location="name"]').textContent = label.toLocaleUpperCase();
    card.querySelector('[data-location="timezone"]').textContent = timeZone;
    card.querySelector('[data-location="clock-label"]').textContent = `LOCAL TIME / ${getTimeZoneName(timeZone)}`;
    card.setAttribute("aria-label", `${label}时间与天气`);
  }

  function updateClock(card) {
    if (!card?.isConnected) return;
    const now = new Date();
    const clock = card.querySelector(".cyber-clock");
    const date = card.querySelector(".cyber-date");
    clock.textContent = timeFormatter.format(now);
    clock.dateTime = now.toISOString();
    date.textContent = dateFormatter.format(now);
  }

  function formatNumber(value, fractionDigits = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(fractionDigits) : "--";
  }

  function renderWeather(card, payload, source = "vercel") {
    if (!card?.isConnected || !payload?.current) return;
    applyLocation(card, payload.location);
    updateClock(card);

    const current = payload.current;
    const [condition, codeLabel, icon] = weatherCodes[current.weather_code] || ["天气未知", "UNKNOWN", "◇"];
    const sunset = payload.daily?.sunset?.[0]?.slice(11, 16) || "--:--";

    card.querySelector(".cyber-weather-icon").textContent = icon;
    card.querySelector(".cyber-temperature").textContent = `${formatNumber(current.temperature_2m)}°`;
    card.querySelector(".cyber-condition").textContent = `${condition} / ${codeLabel}`;
    card.querySelector(".cyber-feels-like").textContent = `体感温度 ${formatNumber(current.apparent_temperature)}°C`;
    card.querySelector('[data-weather="humidity"]').textContent = `${formatNumber(current.relative_humidity_2m)}%`;
    card.querySelector('[data-weather="wind"]').textContent = `${formatNumber(current.wind_speed_10m)} km/h`;
    card.querySelector('[data-weather="sunset"]').textContent = sunset;

    const status = card.querySelector('[data-weather="status"]');
    if (source === "cache") status.textContent = "LOCATION LINK / CACHED";
    else if (source === "fallback") status.textContent = "LOCATION LINK / SYDNEY FALLBACK";
    else status.textContent = "LOCATION LINK / IP APPROX";
    card.classList.remove("is-offline");
    card.classList.add("is-online");
  }

  function readCachedWeather() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      if (cached && Date.now() - cached.savedAt < CACHE_TTL) return cached.payload;
    } catch (_) {
      sessionStorage.removeItem(CACHE_KEY);
    }
    return null;
  }

  function cacheWeather(payload) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
    } catch (_) {
      // The card still works when storage is unavailable.
    }
  }

  async function fetchJson(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadSydneyFallback(card) {
    const forecast = await fetchJson(SYDNEY_WEATHER_URL);
    const payload = {
      location: FALLBACK_LOCATION,
      current: forecast.current,
      daily: forecast.daily
    };
    cacheWeather(payload);
    renderWeather(card, payload, "fallback");
  }

  async function loadWeather(card) {
    const cached = readCachedWeather();
    if (cached) {
      renderWeather(card, cached, "cache");
      return;
    }

    try {
      const payload = await fetchJson(VISITOR_WEATHER_URL);
      if (!payload?.location || !payload?.current) throw new Error("Incomplete visitor weather response");
      cacheWeather(payload);
      renderWeather(card, payload, "vercel");
    } catch (locationError) {
      try {
        await loadSydneyFallback(card);
      } catch (weatherError) {
        if (!card?.isConnected) return;
        applyLocation(card, FALLBACK_LOCATION);
        updateClock(card);
        card.querySelector(".cyber-condition").textContent = "气象数据暂不可用";
        card.querySelector('[data-weather="status"]').textContent = "LOCATION LINK / OFFLINE";
        card.classList.add("is-offline");
        console.warn("Visitor weather widget:", { locationError, weatherError });
      }
    }
  }

  function mountWeatherCard() {
    if (clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }

    const homeContent = document.querySelector(".home-content-container");
    if (!homeContent) return;

    let card = document.getElementById("visitor-status-hud");
    if (!card) {
      card = createCard();
      homeContent.prepend(card);
    }

    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    applyLocation(card, {
      label: "定位中",
      timezone: isValidTimeZone(browserTimeZone) ? browserTimeZone : FALLBACK_LOCATION.timezone
    });
    updateClock(card);
    clockTimer = window.setInterval(() => updateClock(card), 1000);
    loadWeather(card);
  }

  function bindSwup(swup) {
    if (swupBound || !swup?.hooks) return;
    swupBound = true;
    swup.hooks.on("page:view", mountWeatherCard);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWeatherCard, { once: true });
  } else {
    mountWeatherCard();
  }

  if (window.swup?.hooks) {
    bindSwup(window.swup);
  } else {
    window.addEventListener(
      "redefine:swup:ready",
      (event) => bindSwup(event.detail?.swup || window.swup),
      { once: true }
    );
  }
})();
