'use strict';

const express  = require('express');
const OpenAI   = require('openai');
const { db, stmts } = require('../database');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Weight goal CRUD ─────────────────────────────────────────────────────────

// GET /api/goals/weight  — active goal + recent logs
router.get('/weight', (req, res) => {
  const goal = db.prepare(`
    SELECT * FROM weight_goals WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  const logs = db.prepare(`
    SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 60
  `).all(req.user.id);

  res.json({ goal: goal || null, logs });
});

// POST /api/goals/weight  — create/replace goal
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

// DELETE /api/goals/weight/:id
router.delete('/weight/:id', (req, res) => {
  db.prepare(`DELETE FROM weight_goals WHERE id = ? AND user_id = ?`)
    .run(parseInt(req.params.id), req.user.id);
  res.json({ success: true });
});

// POST /api/goals/weight/log  — log today's weight
router.post('/weight/log', express.json(), (req, res) => {
  const { weight, note } = req.body;
  if (!weight) return res.status(400).json({ error: 'weight required.' });
  const result = db.prepare(`
    INSERT INTO weight_logs (user_id, weight, note)
    VALUES (?, ?, ?)
  `).run(req.user.id, parseFloat(weight), note || null);
  res.json({ id: result.lastInsertRowid, success: true });
});

// ─── AI Goal Analysis ──────────────────────────────────────────────────────────

// GET /api/goals/weight/analysis
router.get('/weight/analysis', async (req, res) => {
  try {
    const goal = db.prepare(`
      SELECT * FROM weight_goals WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1
    `).get(req.user.id);

    const logs = db.prepare(`
      SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 30
    `).all(req.user.id);

    const user = stmts.getUserById.get(req.user.id);

    if (!goal) return res.json({ message: 'Set a weight goal first to get AI analysis.' });

    const daysLeft = Math.max(0, Math.ceil((new Date(goal.target_date) - new Date()) / 86400000));
    const latestWeight = logs[0]?.weight || user.weight || goal.start_weight;
    const delta = latestWeight - goal.start_weight;
    const needed = latestWeight - goal.target_weight;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a supportive, science-based nutrition and fitness coach. 
Respond in 3-4 short, encouraging sentences with ONE concrete actionable tip. 
Be specific, not generic. No emojis. Plain text only.`
        },
        {
          role: 'user',
          content: `User goal: lose ${needed.toFixed(1)} kg more (from ${latestWeight} kg to ${goal.target_weight} kg).
Deadline: ${daysLeft} days left.
Progress so far: ${Math.abs(delta).toFixed(1)} kg ${delta < 0 ? 'lost' : 'gained'}.
Weight entries: ${logs.slice(0, 7).map(l => `${l.logged_at.slice(0, 10)}: ${l.weight}kg`).join(', ') || 'none yet'}.
User: ${user.age || '?'} years, ${user.gender || '?'}, ${user.activity || 'moderate'} activity.
Provide a brief progress analysis and one actionable tip.`
        }
      ],
      max_tokens: 200
    });

    res.json({ analysis: completion.choices[0].message.content.trim() });
  } catch (e) {
    res.status(500).json({ error: 'Analysis failed: ' + e.message });
  }
});

module.exports = router;
