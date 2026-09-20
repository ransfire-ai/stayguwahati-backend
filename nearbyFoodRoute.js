/**
 * StayGuwahati -> Google Places proxy
 *
 * Add this router to the EXISTING Express backend.
 * It keeps the Google Places API key on Render and exposes only the
 * seven approved neighbourhood searches needed by the SEO pages.
 */
const express = require("express");
const router = express.Router();

const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PROXY_SECRET = process.env.STAYGUWAHATI_PLACES_PROXY_SECRET;
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const NEIGHBOURHOODS = {
  "uzan-bazar": { latitude: 26.1885, longitude: 91.7444, radius: 1800 },
  "paltan-bazar": { latitude: 26.1813, longitude: 91.7560, radius: 1800 },
  "ganeshguri": { latitude: 26.1397, longitude: 91.7895, radius: 1800 },
  "maligaon": { latitude: 26.1608, longitude: 91.6879, radius: 1800 },
  "chandmari": { latitude: 26.1874, longitude: 91.7685, radius: 1800 },
  "panjabari": { latitude: 26.1458, longitude: 91.8260, radius: 1800 },
  "six-mile": { latitude: 26.1329, longitude: 91.8060, radius: 1800 },
};

// Small per-process guard against accidental/bot abuse. This is not a replacement
// for a production rate limiter if you already use Redis or another shared limiter.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || "unknown")
    .split(",")[0]
    .trim();
}

function rateLimited(ip) {
  const now = Date.now();
  const current = hits.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    hits.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

router.get("/nearby-food", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!PROXY_SECRET || !GOOGLE_API_KEY) {
    return res.status(503).json({ error: "Google Places proxy is not configured." });
  }

  const suppliedSecret = String(req.get("X-StayGuwahati-Places-Secret") || "");
  if (!suppliedSecret || suppliedSecret !== PROXY_SECRET) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const ip = requestIp(req);
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please try again shortly." });
  }

  const slug = String(req.query.slug || "").trim().toLowerCase();
  const area = NEIGHBOURHOODS[slug];
  if (!area) {
    return res.status(400).json({ error: "Unsupported neighbourhood." });
  }

  try {
    const googleResponse = await fetch(GOOGLE_PLACES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.shortFormattedAddress",
          "places.rating",
          "places.userRatingCount",
          "places.googleMapsUri",
          "places.primaryType",
          "places.types",
        ].join(","),
      },
      body: JSON.stringify({
        includedTypes: ["restaurant", "cafe"],
        maxResultCount: 10,
        rankPreference: "POPULARITY",
        languageCode: "en",
        regionCode: "IN",
        locationRestriction: {
          circle: {
            center: {
              latitude: area.latitude,
              longitude: area.longitude,
            },
            radius: area.radius,
          },
        },
      }),
    });

    const payload = await googleResponse.json().catch(() => ({}));
    if (!googleResponse.ok) {
      console.error("Google Places error", googleResponse.status, payload);
      return res.status(502).json({ error: "Google Places request failed." });
    }

    return res.status(200).json({
      places: Array.isArray(payload.places) ? payload.places.slice(0, 10) : [],
    });
  } catch (error) {
    console.error("Google Places proxy error", error);
    return res.status(502).json({ error: "Unable to reach Google Places." });
  }
});

module.exports = router;
