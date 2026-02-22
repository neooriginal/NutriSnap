'use strict';

const express = require('express');
const { db }  = require('../database');

const router = express.Router();

// ─── Start fast ───────────────────────────────────────────────────────────────
// POST /api/fasting/start
router.post('/start', express.json(), (req, res) => {
  // Cancel any running fast first
  db.prepare(`
    UPDATE fasting_sessions SET status = 'cancelled', ended_at = datetime('now')
    WHERE user_id = ? AND status = 'active'
  `).run(req.user.id);

  const { target_hours, protocol } = req.body;
  const result = db.prepare(`
    INSERT INTO fasting_sessions (user_id, started_at, target_hours, protocol)
    VALUES (?, datetime('now'), ?, ?)
  `).run(req.user.id, parseFloat(target_hours) || 16, protocol || '16:8');

  const session = db.prepare(`SELECT * FROM fasting_sessions WHERE id = ?`).get(result.lastInsertRowid);
  res.json({ session });
});

// ─── End fast ─────────────────────────────────────────────────────────────────
// POST /api/fasting/end
router.post('/end', express.json(), (req, res) => {
  const { feeling, note } = req.body;
  const session = db.prepare(`
    SELECT * FROM fasting_sessions WHERE user_id = ? AND status = 'active'
  `).get(req.user.id);

  if (!session) return res.status(404).json({ error: 'No active fast.' });

  const startedAt = new Date(session.started_at + 'Z');
  const now       = new Date();
  const actual_hours = parseFloat(((now - startedAt) / 3600000).toFixed(2));

  db.prepare(`
    UPDATE fasting_sessions
    SET status = 'completed', ended_at = datetime('now'),
        actual_hours = ?, feeling = ?, note = ?
    WHERE id = ?
  `).run(actual_hours, feeling || null, note || null, session.id);

  res.json({ success: true, actual_hours });
});

// ─── Cancel fast ──────────────────────────────────────────────────────────────
// POST /api/fasting/cancel
router.post('/cancel', (req, res) => {
  db.prepare(`
    UPDATE fasting_sessions SET status = 'cancelled', ended_at = datetime('now')
    WHERE user_id = ? AND status = 'active'
  `).run(req.user.id);
  res.json({ success: true });
});

// ─── Current fast status ──────────────────────────────────────────────────────
// GET /api/fasting/current
router.get('/current', (req, res) => {
  const session = db.prepare(`
    SELECT * FROM fasting_sessions WHERE user_id = ? AND status = 'active'
  `).get(req.user.id);
  res.json({ session: session || null });
});

// ─── Fasting history ──────────────────────────────────────────────────────────
// GET /api/fasting/history?limit=20
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const rows  = db.prepare(`
    SELECT * FROM fasting_sessions
    WHERE user_id = ? AND status != 'active'
    ORDER BY started_at DESC
    LIMIT ?
  `).all(req.user.id, limit);

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      ROUND(AVG(actual_hours), 1) AS avg_hours,
      ROUND(MAX(actual_hours), 1) AS best_hours,
      COUNT(CASE WHEN actual_hours >= target_hours THEN 1 END) AS completed_goal
    FROM fasting_sessions
    WHERE user_id = ? AND status = 'completed'
  `).get(req.user.id);

  res.json({ sessions: rows, stats });
});

module.exports = router;
