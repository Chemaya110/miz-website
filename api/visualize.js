// MIZ Management - AI floor visualizer
// Vercel serverless function. Receives a room photo from the website and asks
// Google's Nano Banana image model (Gemini API) to replace only the floor.
// Your Gemini API key stays here on the server; it is never sent to visitors.
//
// Environment variables (set them in Vercel > Project > Settings > Environment Variables):
//   GEMINI_API_KEY            required. Create one at https://aistudio.google.com/apikey
//   GEMINI_MODEL              optional. Default: gemini-3.1-flash-image (Nano Banana 2)
//   ALLOWED_ORIGIN            optional. e.g. https://www.mizmanagement.com  (blocks other sites from using your key)
//   HOURLY_LIMIT_PER_VISITOR  optional. Default: 10 previews per visitor per hour

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-image";
const LIMIT = Number(process.env.HOURLY_LIMIT_PER_VISITOR || 10);
const MAX_BASE64 = 6 * 1024 * 1024; // about 4.5 MB image
const MIMES = ["image/jpeg", "image/png", "image/webp"];

// Only these looks can be requested, so nobody can use your key for other images.
const STYLES = {
  lvt: {
    oak: "light natural oak luxury vinyl plank flooring, 7-inch wide planks, subtle realistic wood grain, matte finish",
    coastal: "whitewashed light grey-beige oak-look luxury vinyl plank flooring, wide planks, matte finish",
    herring: "honey-toned oak-look luxury vinyl flooring laid in a herringbone pattern",
  },
  spc: {
    grey: "weathered grey wood-look SPC rigid-core plank flooring, long planks, matte finish",
    ash: "pale ash wood-look SPC plank flooring with soft cool tones, matte finish",
    greige: "greige stone-look SPC flooring in 12x24 inch tiles with thin grout lines",
  },
  porcelain: {
    marble: "polished white Calacatta marble-look large-format porcelain tile, 24x48 inch tiles, thin light grey grout lines, glossy surface with soft natural reflections",
    travertine: "matte warm beige travertine-look porcelain tile, 24x24 inch tiles, thin grout lines",
    slate: "matte charcoal slate-look porcelain tile, 24x48 inch tiles, thin dark grout lines",
    terrazzo: "light terrazzo-look porcelain tile with small multicolored stone chips, 24x24 inch tiles",
  },
  wood: {
    walnut: "rich warm walnut engineered hardwood flooring, wide planks, satin finish",
    whiteoak: "wide-plank European white oak engineered hardwood flooring, 9-inch planks, natural matte finish",
    chevron: "natural oak engineered hardwood flooring laid in a chevron pattern, satin finish",
  },
};

function buildPrompt(floor) {
  return [
    "Edit this photo of a room. Replace ONLY the floor surface with: " + floor + ".",
    "Keep everything else exactly the same: walls, ceiling, furniture, rugs, windows, doors, decor, lighting, camera angle and framing.",
    "The new floor must follow the room's perspective and vanishing lines, meet the baseboards cleanly, pass naturally under furniture edges,",
    "and show realistic shadows and reflections that match the existing light.",
    "The result must look like a real interior photograph. Do not add text, logos or watermarks.",
  ].join(" ");
}

const hits = new Map(); // simple per-instance rate limit
function limited(ip) {
  const now = Date.now(), hour = 3600e3;
  const list = (hits.get(ip) || []).filter((t) => now - t < hour);
  if (list.length >= LIMIT) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}

async function callGemini(version, key, body, signal) {
  return fetch(`https://generativelanguage.googleapis.com/${version}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal,
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "The visualizer isn't set up yet. Add GEMINI_API_KEY in your hosting settings." });

  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin && !allowed.split(",").map((s) => s.trim()).includes(req.headers.origin)) {
    return res.status(403).json({ error: "Not allowed." });
  }

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  if (limited(ip)) return res.status(429).json({ error: "You've made a lot of previews in the last hour. Try again later, or call us and we'll bring samples to you." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const { image, mime = "image/jpeg", material, style } = body || {};
  const floor = STYLES[material] && STYLES[material][style];
  if (!floor) return res.status(400).json({ error: "Pick a floor and a look, then try again." });
  if (!MIMES.includes(mime)) return res.status(400).json({ error: "Upload a JPG, PNG or WebP photo." });
  if (typeof image !== "string" || image.length < 100 || image.length > MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image)) {
    return res.status(400).json({ error: "That photo couldn't be read. Try a smaller JPG or PNG." });
  }

  const payload = {
    contents: [{ parts: [{ text: buildPrompt(floor) }, { inline_data: { mime_type: mime, data: image } }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55e3);
  try {
    let r = await callGemini("v1", key, payload, ctrl.signal);
    if (r.status === 404) r = await callGemini("v1beta", key, payload, ctrl.signal); // older API path
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("Gemini error", r.status, JSON.stringify(data).slice(0, 800));
      if (r.status === 429) return res.status(503).json({ error: "The visualizer is busy right now. Try again in a minute." });
      return res.status(502).json({ error: "The visualizer couldn't finish this one. Try again or use a different photo." });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const img = parts.filter((p) => !p.thought).map((p) => p.inlineData || p.inline_data).filter(Boolean).pop();
    if (!img || !img.data) {
      console.error("Gemini returned no image", JSON.stringify(data).slice(0, 800));
      return res.status(422).json({ error: "We couldn't redraw the floor in this photo. Try a photo where more of the floor is visible." });
    }
    const outMime = img.mimeType || img.mime_type || "image/png";
    return res.status(200).json({ image: `data:${outMime};base64,${img.data}` });
  } catch (e) {
    console.error("Visualizer failed", e);
    const timeout = e && e.name === "AbortError";
    return res.status(504).json({ error: timeout ? "That took too long. Try again in a moment." : "Something went wrong. Try again." });
  } finally {
    clearTimeout(timer);
  }
};

module.exports.STYLES = STYLES;
module.exports.buildPrompt = buildPrompt;
