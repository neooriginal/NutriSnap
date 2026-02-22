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


router.post('/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided.' });

    const base64  = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/jpeg';
    const dataUri  = `data:${mimeType};base64,${base64}`;
    console.log('[analyze] image size:', Math.round(req.file.buffer.length / 1024), 'KB');

    const systemPrompt = `You are a nutrition expert. Analyze the food in the image.
Always respond with ONLY valid JSON — no markdown, no extra text. Use this exact structure:
{"food_name":"string","description":"string","serving_size":"string","calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number,"confidence":"high|medium|low"}
If you cannot identify food, still return the JSON with your best guess and confidence:"low".
NEVER return null. Always return a JSON object.`;

    const userNote = (req.body?.notes || '').trim();
    const userText = userNote
      ? `Analyze this food image and return the nutrition JSON. The user added a note: "${userNote}"`
      : 'Analyze this food image and return the nutrition JSON.';

    const makeRequest = () => openai.chat.completions.create({
      model: 'gpt-5-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUri, detail: 'auto' } }
        ]}
      ],
      max_completion_tokens: 800
    });

    let completion = await makeRequest();
    let raw = completion.choices[0].message.content;
    console.log('[analyze] finish_reason:', completion.choices[0].finish_reason, 'raw:', raw?.slice(0, 200));

    let nutrition;
    try { nutrition = JSON.parse(raw); } catch (_) { nutrition = null; }

    // Retry once if we got a null/invalid response
    if (!nutrition || typeof nutrition !== 'object') {
      console.log('[analyze] Got null, retrying...');
      completion = await makeRequest();
      raw = completion.choices[0].message.content;
      console.log('[analyze] retry raw:', raw?.slice(0, 200));
      try { nutrition = JSON.parse(raw); } catch (_) { nutrition = null; }
    }

    if (!nutrition || typeof nutrition !== 'object') {
      return res.status(422).json({ error: "Couldn't identify the food in this image. Please try a clearer photo." });
    }

    nutrition.image_preview = dataUri;
    res.json(nutrition);
  } catch (err) {
    console.error('OpenAI error:', err.message);
    res.status(500).json({ error: 'Failed to analyze image. ' + err.message });
  }
});


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


router.get('/logs', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const logs = stmts.getLogsByDate.all(req.user.id, date);
  const totals = stmts.getTodayTotals.get(req.user.id, date);
  res.json({ logs, totals, date });
});


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


router.delete('/log/:id', (req, res) => {
  const result = stmts.deleteLog.run(parseInt(req.params.id), req.user.id);
  if (result.changes === 0)
    return res.status(404).json({ error: 'Entry not found.' });
  res.json({ success: true });
});

module.exports = router;
