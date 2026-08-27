(() => {
  "use strict";

  const WEATHER_URL =
    "https://api.open-meteo.com/v1/forecast?latitude=-33.8688&longitude=151.2093&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&daily=sunrise,sunset&timezone=Australia%2FSydney&forecast_days=1";
  const CACHE_KEY = "aden-sydney-weather-v1";
  const CACHE_TTL = 10 * 60 * 1000;
  const SYDNEY_TIME_ZONE = "Australia/Sydney";

  let clockTimer = null;
  let swupBound = false;

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

  const timeFormatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: SYDNEY_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });

  function createCard() {
    const card = document.createElement("section");
    card.className = "cyber-weather-card";
    card.id = "sydney-status-hud";
    card.setAttribute("aria-label", "悉尼时间与天气");
    card.innerHTML = `
      <div class="cyber-weather-header">
        <span class="cyber-weather-live"><i aria-hidden="true"></i> LIVE // SYDNEY</span>
        <span class="cyber-weather-coords">33.8688°S / 151.2093°E</span>
      </div>
      <div class="cyber-weather-grid">
        <div class="cyber-clock-block">
          <span class="cyber-data-label">LOCAL TIME / AEST·AEDT</span>
          <time class="cyber-clock" datetime="">--:--:--</time>
          <span class="cyber-date">正在校准时间…</span>
        </div>
        <div class="cyber-current-weather" aria-live="polite">
          <span class="cyber-weather-icon" aria-hidden="true">◌</span>
          <div>
            <span class="cyber-temperature">--°</span>
            <span class="cyber-condition">连接气象节点…</span>
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
        <span data-weather="status">WEATHER LINK / CONNECTING</span>
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">DATA / OPEN-METEO</a>
      </div>`;
    return card;
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

  function renderWeather(card, payload, source = "live") {
    if (!card?.isConnected || !payload?.current) return;
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
    card.querySelector('[data-weather="status"]').textContent =
      source === "cache" ? "WEATHER LINK / CACHED" : "WEATHER LINK / NOMINAL";
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

  async function loadWeather(card) {
    const cached = readCachedWeather();
    if (cached) {
      renderWeather(card, cached, "cache");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(WEATHER_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
      const payload = await response.json();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
      renderWeather(card, payload);
    } catch (error) {
      if (!card?.isConnected) return;
      card.querySelector(".cyber-condition").textContent = "气象数据暂不可用";
      card.querySelector('[data-weather="status"]').textContent = "WEATHER LINK / OFFLINE";
      card.classList.add("is-offline");
      console.warn("Sydney weather widget:", error);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function mountWeatherCard() {
    if (clockTimer) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }

    const homeContent = document.querySelector(".home-content-container");
    if (!homeContent) return;

    let card = document.getElementById("sydney-status-hud");
    if (!card) {
      card = createCard();
      homeContent.prepend(card);
    }

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
