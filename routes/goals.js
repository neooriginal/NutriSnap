'use strict';

const express  = require('express');
const OpenAI   = require('openai');
const { db, stmts } = require('../database');
const { computeStats } = require('../utils');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.get('/weight', (req, res) => {
  const goal = db.prepare(`
    SELECT * FROM weight_goals WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  const logs = db.prepare(`
    SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 60
  `).all(req.user.id);

  res.json({ goal: goal || null, logs });
});

router.post('/weight', express.json(), (req, res) => {
  const { target_weight, target_date, notes } = req.body;
  if (!target_weight || !target_date)
    return res.status(400).json({ error: 'target_weight and target_date required.' });

  // Deactivate old goals
  db.prepare(`UPDATE weight_goals SET active = 0 WHERE user_id = ?`).run(req.user.id);

  const result = db.prepare(`
    INSERT INTO weight_goals (user_id, start_weight, target_weight, target_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, req.user.weight || 0, parseFloat(target_weight), target_date, notes || null);

  res.json({ id: result.lastInsertRowid, success: true });
});

router.delete('/weight/:id', (req, res) => {
  db.prepare(`DELETE FROM weight_goals WHERE id = ? AND user_id = ?`)
    .run(parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

router.post('/weight/log', express.json(), (req, res) => {
  const { weight, note } = req.body;
  if (!weight) return res.status(400).json({ error: 'weight required.' });
  const result = db.prepare(`
    INSERT INTO weight_logs (user_id, weight, note)
    VALUES (?, ?, ?)
  `).run(req.user.id, parseFloat(weight), note || null);
  res.json({ id: result.lastInsertRowid, success: true });
});

router.get('/weight/analysis', async (req, res) => {
  try {
    const goal = db.prepare(`
      SELECT * FROM weight_goals WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1
    `).get(req.user.id);

    const logs = db.prepare(`
      SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 30
    `).all(req.user.id);

    const raw  = stmts.getUserById.get(req.user.id);
    const user = { ...raw, ...computeStats(raw) };

    if (!goal) return res.json({ message: "Set a weight goal first — then tap 'Get AI tips' for personalised coaching." });

    const daysLeft = Math.max(0, Math.ceil((new Date(goal.target_date) - new Date()) / 86400000));
    const latestWeight = logs[0]?.weight || user.weight || goal.start_weight;
    const delta = latestWeight - goal.start_weight;
    const needed = latestWeight - goal.target_weight;

    const completion = await openai.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'developer',
          content: `You are a direct weight coach. Tell the user exactly what they need to do NOW to hit their goal.
- Plain language — no jargon.
- If on track, raise the bar: "keep it up, and also do X to make it certain."
- If off track, be honest and name the single most important change to make this week.
- End with a specific, time-bound action (e.g. "log your weight every morning before breakfast").
- 3 sentences max. No emojis. No generic advice.`
        },
        {
          role: 'user',
          content: `Goal: lose ${needed.toFixed(1)} more kg (from ${latestWeight} kg to ${goal.target_weight} kg).
Time left: ${daysLeft} days.
Progress so far: ${Math.abs(delta).toFixed(1)} kg ${delta < 0 ? 'lost' : 'gained'}.
Recent weigh-ins: ${logs.slice(0, 7).map(l => `${l.logged_at.slice(0, 10)}: ${l.weight}kg`).join(', ') || 'none yet'}.
Person: ${user.age || '?'} years, ${user.gender || '?'}, ${user.activity || 'moderate'} activity.
Give a direct, honest progress check and the one most important action to take this week.`
        }
      ],
      reasoning_effort: 'low',
      max_completion_tokens: 1500
    });

    res.json({ analysis: (completion.choices[0].message.content || completion.choices[0].message.refusal || '').trim() });
  } catch (e) {
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

module.exports = router;
