'use strict';

const express = require('express');
const OpenAI  = require('openai');
const { db, stmts } = require('../database');

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Daily AI insight ─────────────────────────────────────────────────────────
// GET /api/insights/daily
router.get('/daily', async (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.id);

    // Last 7 days food summary
    const to   = new Date().toISOString().slice(0, 10);
    const from = (() => { const d = new Date(to); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
    const nutrition = db.prepare(`
      SELECT log_date,
             ROUND(SUM(calories),0) AS cal,
             ROUND(SUM(protein),1)  AS prot,
             ROUND(SUM(carbs),1)    AS carb,
             ROUND(SUM(fat),1)      AS fat
      FROM food_logs WHERE user_id = ? AND log_date BETWEEN ? AND ?
      GROUP BY log_date ORDER BY log_date
    `).all(req.user.id, from, to);

    // Active fast
    const activeFast = db.prepare(`
      SELECT *, ROUND((julianday('now') - julianday(started_at)) * 24, 1) AS elapsed_hours
      FROM fasting_sessions WHERE user_id = ? AND status = 'active'
    `).get(req.user.id);

    // Fasting stats last 7 days
    const fastingStats = db.prepare(`
      SELECT COUNT(*) AS count, ROUND(AVG(actual_hours),1) AS avg_h
      FROM fasting_sessions WHERE user_id = ? AND status = 'completed'
        AND started_at >= date('now', '-7 days')
    `).get(req.user.id);

    // Weight goal
    const weightGoal = db.prepare(`
      SELECT wg.*, wl.weight AS latest_weight
      FROM weight_goals wg
      LEFT JOIN weight_logs wl ON wl.user_id = wg.user_id
      WHERE wg.user_id = ? AND wg.active = 1
      ORDER BY wl.logged_at DESC LIMIT 1
    `).get(req.user.id);

    // Build prompt context
    const nutritionStr = nutrition.length
      ? nutrition.map(n => `${n.log_date}: ${n.cal} kcal (P:${n.prot}g C:${n.carb}g F:${n.fat}g)`).join('\n')
      : 'No meals logged yet this week.';

    const fastStr = activeFast
      ? `Currently ${activeFast.elapsed_hours}h into a ${activeFast.target_hours}h fast.`
      : fastingStats.count
        ? `${fastingStats.count} completed fasts this week, avg ${fastingStats.avg_h}h each.`
        : 'No fasting this week.';

    const goalStr = weightGoal
      ? `Weight goal: reach ${weightGoal.target_weight}kg by ${weightGoal.target_date}. Current: ${weightGoal.latest_weight || user.weight || '?'}kg.`
      : 'No weight goal set.';

    const targetCal  = user.calorie_target || 2000;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a proactive, evidence-based nutrition coach delivering a personalized daily briefing.
Rules:
- Be direct and specific, not generic.
- Max 4 sentences total.
- Format: 1 observation about recent nutrition, 1 about fasting/goal progress, 1 actionable tip for today.
- Plain text, no markdown, no emojis.`
        },
        {
          role: 'user',
          content: `User profile: ${user.age || '?'}y ${user.gender || 'person'}, ${user.activity || 'moderate'} activity, goal: ${user.goal || 'maintain'}.
Daily calorie target: ${targetCal} kcal.

Last 7 days nutrition:
${nutritionStr}

Fasting: ${fastStr}

Weight: ${goalStr}

Give a brief personalized daily insight.`
        }
      ],
      max_tokens: 200
    });

    res.json({ insight: completion.choices[0].message.content.trim() });
  } catch (e) {
    res.status(500).json({ error: 'Insight generation failed: ' + e.message });
  }
});

// ─── Weekly deep analysis ─────────────────────────────────────────────────────
// GET /api/insights/weekly
router.get('/weekly', async (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.id);
    const to   = new Date().toISOString().slice(0, 10);
    const from = (() => { const d = new Date(to); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();

    const nutrition = db.prepare(`
      SELECT log_date,
             ROUND(SUM(calories),0) AS cal,
             ROUND(SUM(protein),1)  AS prot,
             ROUND(SUM(carbs),1)    AS carb,
             ROUND(SUM(fat),1)      AS fat,
             COUNT(*) AS entries
      FROM food_logs WHERE user_id = ? AND log_date BETWEEN ? AND ?
      GROUP BY log_date ORDER BY log_date
    `).all(req.user.id, from, to);

    const fastingHistory = db.prepare(`
      SELECT protocol, actual_hours, target_hours, status, started_at
      FROM fasting_sessions WHERE user_id = ?
        AND started_at >= date('now', '-30 days')
      ORDER BY started_at DESC
    `).all(req.user.id);

    const weightLogs = db.prepare(`
      SELECT weight, logged_at FROM weight_logs
      WHERE user_id = ? AND logged_at >= date('now', '-30 days')
      ORDER BY logged_at
    `).all(req.user.id);

    const avgCal  = nutrition.length ? Math.round(nutrition.reduce((a, b) => a + b.cal, 0) / nutrition.length) : 0;
    const logDays = nutrition.length;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a proactive nutrition and wellness coach writing a 30-day analysis report. 
Structure your response in exactly 3 labeled sections (no markdown):
WINS: One sentence on what went well.
CONCERNS: One specific concern to address.
THIS WEEK: Two concrete, personalized action items for the next 7 days.
Plain text only, no emojis.`
        },
        {
          role: 'user',
          content: `30-day data for ${user.name || 'user'}:
- Days logged: ${logDays}/30
- Avg daily calories: ${avgCal} kcal (target: ${user.calorie_target || 2000})
- Completed fasts: ${fastingHistory.filter(f => f.status === 'completed').length}, avg ${fastingHistory.filter(f => f.status === 'completed').length ? (fastingHistory.filter(f => f.status === 'completed').reduce((a, b) => a + b.actual_hours, 0) / fastingHistory.filter(f => f.status === 'completed').length).toFixed(1) : 0}h
- Weight change: ${weightLogs.length >= 2 ? (weightLogs[weightLogs.length - 1].weight - weightLogs[0].weight).toFixed(1) + 'kg over ' + weightLogs.length + ' measurements' : 'insufficient data'}
- User goal: ${user.goal || 'maintain'}, activity: ${user.activity || 'moderate'}
Provide a 30-day analysis.`
        }
      ],
      max_tokens: 300
    });

    res.json({ report: completion.choices[0].message.content.trim() });
  } catch (e) {
    res.status(500).json({ error: 'Report generation failed: ' + e.message });
  }
});

module.exports = router;
