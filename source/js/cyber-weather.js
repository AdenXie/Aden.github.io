(() => {
  "use strict";

  const VISITOR_WEATHER_URL = "/api/visitor-weather";
  const CACHE_KEY = "aden-visitor-weather-v2";
  const CACHE_TTL = 10 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 1500;
  const ERROR_MESSAGES = {
    connection_timeout: "连接天气服务超时",
    connection_failed: "无法连接天气服务，请检查网络",
    location_unavailable: "暂时无法识别 IP 所在地区",
    weather_timeout: "天气数据源响应超时",
    weather_unavailable: "天气数据源暂不可用",
    invalid_response: "天气服务返回的数据异常",
    not_found: "天气接口不存在（404）",
    access_denied: "天气请求被拒绝",
    rate_limited: "天气请求过于频繁，请稍后再试",
    service_unavailable: "天气接口暂不可用"
  };

  let clockTimer = null;
  let swupBound = false;
  let activeTimeZone = getDeviceLocation().timezone;
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

  function getDeviceLocation() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { label: "设备时间", timezone: isValidTimeZone(timezone) ? timezone : "UTC" };
  }

  function applyLocation(card, location = getDeviceLocation()) {
    const timeZone = isValidTimeZone(location.timezone) ? location.timezone : getDeviceLocation().timezone;
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
    const sunsetValue = payload.daily?.sunset?.[0];
    const sunset = typeof sunsetValue === "string" ? sunsetValue.slice(11, 16) : "--:--";

    card.querySelector(".cyber-weather-icon").textContent = icon;
    card.querySelector(".cyber-temperature").textContent = `${formatNumber(current.temperature_2m)}°`;
    card.querySelector(".cyber-condition").textContent = `${condition} / ${codeLabel}`;
    card.querySelector(".cyber-feels-like").textContent = `体感温度 ${formatNumber(current.apparent_temperature)}°C`;
    card.querySelector('[data-weather="humidity"]').textContent = `${formatNumber(current.relative_humidity_2m)}%`;
    card.querySelector('[data-weather="wind"]').textContent = `${formatNumber(current.wind_speed_10m)} km/h`;
    card.querySelector('[data-weather="sunset"]').textContent = sunset;

    const status = card.querySelector('[data-weather="status"]');
    if (source === "cache") status.textContent = "LOCATION LINK / CACHED";
    else status.textContent = "LOCATION LINK / IP APPROX";
    card.classList.remove("is-offline");
    card.classList.add("is-online");
  }

  function isValidWeather(payload) {
    return Boolean(
      payload &&
      typeof payload.location === "object" &&
      payload.location !== null &&
      payload.location.source !== "fallback" &&
      typeof payload.location.timezone === "string" &&
      isValidTimeZone(payload.location.timezone) &&
      payload.current &&
      Number.isFinite(payload.current.temperature_2m) &&
      Number.isFinite(payload.current.weather_code)
    );
  }

  function clearCachedWeather() {
    try {
      sessionStorage.removeItem(CACHE_KEY);
    } catch (_) {
      // Storage may be blocked entirely, including removal. It is optional.
    }
  }

  function readCachedWeather() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      const age = Date.now() - cached?.savedAt;
      if (
        Number.isFinite(cached?.savedAt) &&
        age >= 0 &&
        age < CACHE_TTL &&
        isValidWeather(cached.payload)
      ) return cached.payload;
    } catch (_) {
      // Unreadable or malformed cache must not prevent a network request.
    }
    clearCachedWeather();
    return null;
  }

  function cacheWeather(payload) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
    } catch (_) {
      // The card still works when storage is unavailable.
    }
  }

  function weatherError(code) {
    return Object.assign(new Error(code), { code });
  }

  function errorMessage(error) {
    return ERROR_MESSAGES[error?.code] || ERROR_MESSAGES.service_unavailable;
  }

  function canRetry(error) {
    return ["connection_timeout", "connection_failed", "weather_timeout", "weather_unavailable", "service_unavailable"].includes(error?.code);
  }

  async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        if (response.ok) throw weatherError("invalid_response");
      }
      if (!response.ok) {
        const statusCode = { 404: "not_found", 401: "access_denied", 403: "access_denied", 429: "rate_limited" }[response.status];
        const sourceCode = ["location_unavailable", "weather_timeout", "weather_unavailable"].includes(payload?.error) ? payload.error : null;
        throw weatherError(statusCode || sourceCode || "service_unavailable");
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw weatherError("connection_timeout");
      throw error?.code ? error : weatherError("connection_failed");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadWeather(card) {
    try {
      const cached = readCachedWeather();
      if (cached) {
        renderWeather(card, cached, "cache");
        return;
      }
    } catch (_) {
      // A cached payload that cannot render must fall through to a fresh request.
      clearCachedWeather();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await fetchJson(VISITOR_WEATHER_URL);
        if (!isValidWeather(payload)) throw weatherError("invalid_response");
        cacheWeather(payload);
        renderWeather(card, payload, "vercel");
        return;
      } catch (error) {
        if (!card?.isConnected) return;
        if (attempt === 0 && canRetry(error)) {
          card.querySelector(".cyber-condition").textContent = `${errorMessage(error)}，正在重试…`;
          card.querySelector('[data-weather="status"]').textContent = "LOCATION LINK / RETRY 1/1";
          await new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS));
          if (!card.isConnected) return;
          continue;
        }
        applyLocation(card, getDeviceLocation());
        updateClock(card);
        card.querySelector(".cyber-temperature").textContent = "--°";
        card.querySelector(".cyber-weather-icon").textContent = "!";
        card.querySelector(".cyber-feels-like").textContent = "已保留设备时区 · 可稍后刷新重试";
        for (const [key, value] of [["humidity", "--%"], ["wind", "-- km/h"], ["sunset", "--:--"]]) {
          card.querySelector(`[data-weather="${key}"]`).textContent = value;
        }
        card.querySelector(".cyber-condition").textContent = errorMessage(error);
        card.querySelector('[data-weather="status"]').textContent = "LOCATION LINK / OFFLINE · 设备时间";
        card.classList.remove("is-online");
        card.classList.add("is-offline");
        return;
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

    applyLocation(card, {
      ...getDeviceLocation(),
      label: "定位中",
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
