'use strict';

const express  = require('express');
const multer   = require('multer');
const OpenAI   = require('openai');
const { stmts } = require('../database');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Analyze food from image ──────────────────────────────────────────────────
// POST /api/food/analyze
router.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided.' });

    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const dataUri = `data:${mimeType};base64,${base64}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a nutrition expert AI. Analyze food images and return accurate nutritional data.
Always respond with ONLY valid JSON matching this exact structure:
{
  "food_name": "string (concise name)",
  "description": "string (brief description of what you see)",
  "serving_size": "string (e.g. '1 plate (~350g)')",
  "calories": number,
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams),
  "fiber": number (grams),
  "confidence": "high|medium|low"
}
Be as accurate as possible. If multiple items are visible, estimate the total for the full visible portion.`
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this food image and provide nutritional information.' },
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 500
    });

    const raw = completion.choices[0].message.content;
    const nutrition = JSON.parse(raw);

    // Store image in response for optional frontend use (thumbnail preview)
    nutrition.image_preview = dataUri;

    res.json(nutrition);
  } catch (err) {
    console.error('OpenAI error:', err.message);
    res.status(500).json({ error: 'Failed to analyze image. ' + err.message });
  }
});

// ─── Log a food entry ─────────────────────────────────────────────────────────
// POST /api/food/log
router.post('/log', express.json(), (req, res) => {
  const { food_name, description, calories, protein, carbs, fat, fiber,
          serving_size, meal_type, log_date, image_data } = req.body;

  if (!food_name || calories == null)
    return res.status(400).json({ error: 'food_name and calories are required.' });

  const today = log_date || new Date().toISOString().slice(0, 10);
  const result = stmts.insertLog.run({
    user_id:     req.user.id,
    log_date:    today,
    meal_type:   meal_type   || 'snack',
    food_name,
    description: description || null,
    calories:    parseFloat(calories) || 0,
    protein:     parseFloat(protein)  || 0,
    carbs:       parseFloat(carbs)    || 0,
    fat:         parseFloat(fat)      || 0,
    fiber:       parseFloat(fiber)    || 0,
    serving_size: serving_size || null,
    image_data:  image_data   || null
  });

  res.json({ id: result.lastInsertRowid, success: true });
});

// ─── Get logs for a date ──────────────────────────────────────────────────────
// GET /api/food/logs?date=YYYY-MM-DD
router.get('/logs', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const logs = stmts.getLogsByDate.all(req.user.id, date);
  const totals = stmts.getTodayTotals.get(req.user.id, date);
  res.json({ logs, totals, date });
});

// ─── Get weekly/range summary ─────────────────────────────────────────────────
// GET /api/food/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', (req, res) => {
  const to   = req.query.to   || new Date().toISOString().slice(0, 10);
  const from = req.query.from || (() => {
    const d = new Date(to);
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  })();
  const rows = stmts.getLogsRange.all(req.user.id, from, to);
  res.json({ rows, from, to });
});

// ─── Delete a log entry ───────────────────────────────────────────────────────
// DELETE /api/food/log/:id
router.delete('/log/:id', (req, res) => {
  const result = stmts.deleteLog.run(parseInt(req.params.id), req.user.id);
  if (result.changes === 0)
    return res.status(404).json({ error: 'Entry not found.' });
  res.json({ success: true });
});

module.exports = router;
