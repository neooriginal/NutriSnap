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
          content: `You are a direct, no-nonsense nutrition coach. You proactively tell the user exactly what they need to do TODAY based on their data — not just observations.
Rules:
- Second person ("you", "your") and imperative tone ("eat", "skip", "aim for").
- Be specific with numbers and times (e.g. "add a 30g protein snack before 3pm").
- Identify the single most important action they should take TODAY.
- If behind on calories, say what exactly to eat. If over, say what to cut.
- Max 3 sentences. No generic advice. No emojis. Plain text only.`
        },
        {
          role: 'user',
          content: `User: ${user.age || '?'}y ${user.gender || 'person'}, ${user.activity || 'moderate'} activity, goal: ${user.goal || 'maintain'}, daily target: ${targetCal} kcal.

Last 7 days (date: calories / protein / carbs / fat):
${nutritionStr}

Fasting: ${fastStr}
Weight goal: ${goalStr}
Current time: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}

Given this data, give ONE specific action the user must take TODAY. Be direct and proactive.`
        }
      ],
      max_tokens: 180
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
          content: `You are a blunt nutrition coach writing a 30-day review. Every section must contain a direct action — not just information.
Structure (plain text, no markdown, no emojis):
WINS: One sentence on what actually went well, with a specific number.
FIX THIS: The single biggest issue — name it plainly (e.g. "You're skipping breakfast 4 out of 7 days").
THIS WEEK: Two specific, numbered actions the user must do differently this week — include times or amounts where possible.`
        },
        {
          role: 'user',
          content: `30-day data for ${user.name || 'user'}:
- Days with meals logged: ${logDays}/30
- Average daily calories: ${avgCal} kcal (target: ${user.calorie_target || 2000})
- Completed fasts: ${fastingHistory.filter(f => f.status === 'completed').length}, avg ${fastingHistory.filter(f => f.status === 'completed').length ? (fastingHistory.filter(f => f.status === 'completed').reduce((a, b) => a + b.actual_hours, 0) / fastingHistory.filter(f => f.status === 'completed').length).toFixed(1) : 0}h
- Weight change: ${weightLogs.length >= 2 ? (weightLogs[weightLogs.length - 1].weight - weightLogs[0].weight).toFixed(1) + 'kg over ' + weightLogs.length + ' measurements' : 'not enough data'}
- Goal: ${user.goal || 'maintain'}, activity: ${user.activity || 'moderate'}
Write the 30-day review.`
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
