"use strict";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "is_day"
].join(",");

function readHeader(request, name) {
  const headers = request?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value ?? null;
}

function decodeHeader(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(String(value).replace(/\+/g, "%20"));
  } catch (_) {
    return String(value);
  }
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(payload));
}

function isValidCoordinate(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function parseCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "") return Number.NaN;
  return Number(value);
}

module.exports = async function visitorWeather(request, response) {
  if (request.method && request.method !== "GET") {
    response.setHeader("Allow", "GET");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  const latitude = parseCoordinate(readHeader(request, "x-vercel-ip-latitude"));
  const longitude = parseCoordinate(readHeader(request, "x-vercel-ip-longitude"));

  if (!isValidCoordinate(latitude, longitude)) {
    sendJson(response, 503, { error: "location_unavailable" });
    return;
  }

  const city = decodeHeader(readHeader(request, "x-vercel-ip-city"));
  const region = decodeHeader(readHeader(request, "x-vercel-ip-country-region"));
  const country = decodeHeader(readHeader(request, "x-vercel-ip-country"));
  const label = city || region || country || "当前位置";

  const query = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: CURRENT_FIELDS,
    daily: "sunrise,sunset",
    timezone: "auto",
    forecast_days: "1"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const weatherResponse = await fetch(`${FORECAST_ENDPOINT}?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!weatherResponse.ok) throw new Error(`Open-Meteo returned ${weatherResponse.status}`);

    const forecast = await weatherResponse.json();
    if (!forecast?.current || !forecast?.timezone) throw new Error("Incomplete weather response");

    sendJson(response, 200, {
      location: {
        label,
        city,
        region,
        country,
        timezone: forecast.timezone,
        source: "vercel-ip",
        approximate: true
      },
      current: forecast.current,
      daily: forecast.daily
    });
  } catch (error) {
    sendJson(response, 502, {
      error: error?.name === "AbortError" ? "weather_timeout" : "weather_unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
};
