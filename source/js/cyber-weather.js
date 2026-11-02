(() => {
  "use strict";

  // Interface copy is written in both languages here; the English page reads the English branch.
  // Defined first because getDeviceLocation() runs while the script loads.
  const english = () => document.documentElement.lang.startsWith("en");
  const pick = (zh, en) => (english() ? en : zh);

  // The blog sits behind Alibaba Cloud ESA, so Vercel would locate every visitor at the
  // edge node; geo.adenxie.com.cn points straight at Vercel and sees the visitor's IP.
  const VISITOR_WEATHER_URL = globalThis.location?.hostname === "blog.adenxie.com.cn"
    ? "https://geo.adenxie.com.cn/api/visitor-weather"
    : "/api/visitor-weather";
  const CACHE_KEY = "aden-visitor-weather-v2";
  const CACHE_TTL = 10 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 1500;
  const ERROR_MESSAGES = {
    connection_timeout: ["连接天气服务超时", "Weather service connection timed out"],
    connection_failed: ["无法连接天气服务，请检查网络", "Cannot reach the weather service. Check your network"],
    location_unavailable: ["暂时无法识别 IP 所在地区", "Could not determine your IP location for now"],
    weather_timeout: ["天气数据源响应超时", "Weather data source timed out"],
    weather_unavailable: ["天气数据源暂不可用", "Weather data source is unavailable"],
    invalid_response: ["天气服务返回的数据异常", "Weather service returned invalid data"],
    not_found: ["天气接口不存在（404）", "Weather endpoint not found (404)"],
    access_denied: ["天气请求被拒绝", "Weather request was refused"],
    rate_limited: ["天气请求过于频繁，请稍后再试", "Too many weather requests. Try again later"],
    service_unavailable: ["天气接口暂不可用", "Weather service is unavailable"]
  };

  let activeTimeZone = getDeviceLocation().timezone;
  let timeFormatter = createTimeFormatter(activeTimeZone);
  let dateFormatter = createDateFormatter(activeTimeZone);

  const weatherCodes = {
    0: ["晴朗", "Clear", "SUN", "☀"],
    1: ["大致晴朗", "Mainly clear", "CLEAR", "◒"],
    2: ["局部多云", "Partly cloudy", "CLOUD", "◑"],
    3: ["阴天", "Overcast", "OVERCAST", "☁"],
    45: ["有雾", "Fog", "FOG", "≋"],
    48: ["雾凇", "Rime fog", "RIME", "≋"],
    51: ["小毛毛雨", "Light drizzle", "DRIZZLE", "⋰"],
    53: ["毛毛雨", "Drizzle", "DRIZZLE", "⋰"],
    55: ["较强毛毛雨", "Heavy drizzle", "DRIZZLE", "⋰"],
    56: ["冻毛毛雨", "Freezing drizzle", "ICE RAIN", "❄"],
    57: ["较强冻毛毛雨", "Heavy freezing drizzle", "ICE RAIN", "❄"],
    61: ["小雨", "Light rain", "RAIN", "⌁"],
    63: ["中雨", "Rain", "RAIN", "⌁"],
    65: ["大雨", "Heavy rain", "HEAVY RAIN", "⌁"],
    66: ["冻雨", "Freezing rain", "ICE RAIN", "❄"],
    67: ["较强冻雨", "Heavy freezing rain", "ICE RAIN", "❄"],
    71: ["小雪", "Light snow", "SNOW", "✦"],
    73: ["中雪", "Snow", "SNOW", "✦"],
    75: ["大雪", "Heavy snow", "HEAVY SNOW", "✦"],
    77: ["米雪", "Snow grains", "SNOW", "✦"],
    80: ["局部阵雨", "Light showers", "SHOWERS", "⌁"],
    81: ["阵雨", "Showers", "SHOWERS", "⌁"],
    82: ["强阵雨", "Heavy showers", "SHOWERS", "⌁"],
    85: ["阵雪", "Snow showers", "SNOW", "✦"],
    86: ["强阵雪", "Heavy snow showers", "SNOW", "✦"],
    95: ["雷暴", "Thunderstorm", "STORM", "ϟ"],
    96: ["雷暴伴冰雹", "Thunderstorm with hail", "STORM", "ϟ"],
    99: ["强雷暴伴冰雹", "Severe thunderstorm with hail", "STORM", "ϟ"]
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
    card.setAttribute("aria-label", pick("访客所在地时间与天气", "Visitor location time and weather"));
    card.innerHTML = `
      <div class="cyber-weather-header">
        <span class="cyber-weather-live"><i aria-hidden="true"></i> LIVE // <span data-location="name">LOCATING</span></span>
        <span class="cyber-weather-coords" data-location="timezone">LOCAL NODE</span>
      </div>
      <div class="cyber-weather-grid">
        <div class="cyber-clock-block">
          <span class="cyber-data-label" data-location="clock-label">LOCAL TIME / CALIBRATING</span>
          <time class="cyber-clock" datetime="">--:--:--</time>
          <span class="cyber-date">${pick("正在校准时间…", "Calibrating time…")}</span>
        </div>
        <div class="cyber-current-weather" aria-live="polite">
          <span class="cyber-weather-icon" aria-hidden="true">◌</span>
          <div>
            <span class="cyber-temperature">--°</span>
            <span class="cyber-condition">${pick("正在识别访客地区…", "Locating you…")}</span>
            <span class="cyber-feels-like">${pick("体感温度 --°C", "Feels like --°C")}</span>
            <span class="cyber-observed" data-weather="observed" hidden></span>
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
        <button type="button" class="aden-widget-toggle" aria-controls="visitor-status-hud" aria-expanded="false"></button>
      </div>`;
    return card;
  }

  // Phones show a compact card; the clock and metrics open on demand. Desktop always shows them.
  function setDetails(card, expanded) {
    const toggle = card.querySelector(".aden-widget-toggle");
    card.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = pick(expanded ? "收起详情" : "展开详情", expanded ? "Hide details" : "Show details");
  }

  function getDeviceLocation() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const label = pick("设备时间", "Device time");
    return { label, timezone: isValidTimeZone(timezone) ? timezone : "UTC" };
  }

  function applyLocation(card, location = getDeviceLocation()) {
    const timeZone = isValidTimeZone(location.timezone) ? location.timezone : getDeviceLocation().timezone;
    const label = String(location.label || location.city || location.region || location.country || pick("当前位置", "Current location"));
    activeTimeZone = timeZone;
    timeFormatter = createTimeFormatter(activeTimeZone);
    dateFormatter = createDateFormatter(activeTimeZone);

    card.querySelector('[data-location="name"]').textContent = label.toLocaleUpperCase();
    card.querySelector('[data-location="timezone"]').textContent = timeZone;
    card.querySelector('[data-location="clock-label"]').textContent = `LOCAL TIME / ${getTimeZoneName(timeZone)}`;
    card.setAttribute("aria-label", pick(`${label}时间与天气`, `Time and weather: ${label}`));
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
    const [condition, conditionEn, codeLabel, icon] = weatherCodes[current.weather_code] || ["天气未知", "Unknown weather", "UNKNOWN", "◇"];
    const sunsetValue = payload.daily?.sunset?.[0];
    const sunset = typeof sunsetValue === "string" ? sunsetValue.slice(11, 16) : "--:--";

    card.querySelector(".cyber-weather-icon").textContent = icon;
    card.querySelector(".cyber-temperature").textContent = `${formatNumber(current.temperature_2m)}°`;
    card.querySelector(".cyber-condition").textContent = `${pick(condition, conditionEn)} / ${codeLabel}`;
    const feelsLike = formatNumber(current.apparent_temperature);
    card.querySelector(".cyber-feels-like").textContent = pick(`体感温度 ${feelsLike}°C`, `Feels like ${feelsLike}°C`);
    card.querySelector('[data-weather="humidity"]').textContent = `${formatNumber(current.relative_humidity_2m)}%`;
    card.querySelector('[data-weather="wind"]').textContent = `${formatNumber(current.wind_speed_10m)} km/h`;
    card.querySelector('[data-weather="sunset"]').textContent = sunset;
    // The running clock above is this visitor's device time; this is when the weather was observed.
    const observedAt = typeof current.time === "string" ? current.time.slice(11, 16) : "";
    const observed = card.querySelector('[data-weather="observed"]');
    observed.hidden = !/^\d{2}:\d{2}$/.test(observedAt);
    observed.textContent = observed.hidden ? "" : pick(`天气观测 ${observedAt}（当地时间）`, `Weather observed ${observedAt} local time`);

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
    const [zh, en] = ERROR_MESSAGES[error?.code] || ERROR_MESSAGES.service_unavailable;
    return pick(zh, en);
  }

  function canRetry(error) {
    return ["connection_timeout", "connection_failed", "weather_timeout", "weather_unavailable", "service_unavailable"].includes(error?.code);
  }

  async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS, signal) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (signal?.aborted) { const error = new Error('Cancelled'); error.name = 'AbortError'; throw error; }
    signal?.addEventListener('abort', cancel, { once: true });
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
      signal?.removeEventListener('abort', cancel);
    }
  }

  async function loadWeather(card, signal) {
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

    if (signal?.aborted) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await fetchJson(VISITOR_WEATHER_URL, REQUEST_TIMEOUT_MS, signal);
        if (!isValidWeather(payload)) throw weatherError("invalid_response");
        if (signal?.aborted || !card.isConnected) return;
        cacheWeather(payload);
        renderWeather(card, payload, "vercel");
        return;
      } catch (error) {
        if (signal?.aborted || !card?.isConnected) return;
        if (attempt === 0 && canRetry(error)) {
          card.querySelector(".cyber-condition").textContent = `${errorMessage(error)}${pick("，正在重试…", ", retrying…")}`;
          card.querySelector('[data-weather="status"]').textContent = "LOCATION LINK / RETRY 1/1";
          await (window.AdenSite?.delay(RETRY_DELAY_MS, signal) || new Promise(resolve => window.setTimeout(resolve, RETRY_DELAY_MS)));
          if (signal?.aborted || !card.isConnected) return;
          continue;
        }
        applyLocation(card, getDeviceLocation());
        updateClock(card);
        card.querySelector(".cyber-temperature").textContent = "--°";
        card.querySelector(".cyber-weather-icon").textContent = "!";
        card.querySelector(".cyber-feels-like").textContent = pick("已保留设备时区 · 可稍后刷新重试", "Device time zone kept · try again later");
        for (const [key, value] of [["humidity", "--%"], ["wind", "-- km/h"], ["sunset", "--:--"]]) {
          card.querySelector(`[data-weather="${key}"]`).textContent = value;
        }
        card.querySelector(".cyber-condition").textContent = errorMessage(error);
        card.querySelector('[data-weather="status"]').textContent = pick("LOCATION LINK / OFFLINE · 设备时间", "LOCATION LINK / OFFLINE · device time");
        card.classList.remove("is-online");
        card.classList.add("is-offline");
        return;
      }
    }
  }

  function mountWeatherCard(_root, scope) {
    const homeContent = document.querySelector(".home-content-container");
    // /daily/ reuses the home card list; after a Swup visit from home this script is
    // still loaded there, so skip that page.
    if (!homeContent || homeContent.closest(".aden-daily")) return;

    let card = document.getElementById("visitor-status-hud");
    if (!card) {
      card = createCard();
      homeContent.prepend(card);
    }

    setDetails(card, card.classList.contains("is-expanded"));
    card.querySelector(".aden-widget-toggle").addEventListener("click", () => setDetails(card, !card.classList.contains("is-expanded")), { signal: scope.signal });
    applyLocation(card, {
      ...getDeviceLocation(),
      label: pick("定位中", "Locating"),
    });
    updateClock(card);
    scope.clock(() => updateClock(card));
    const cached = readCachedWeather();
    if (cached) { try { renderWeather(card, cached, "cache"); } catch { clearCachedWeather(); } }
    scope.afterPaint(() => loadWeather(card, scope.signal));
  }

  window.AdenSite?.register('weather', '.home-content-container', mountWeatherCard);
})();
