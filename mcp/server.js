'use strict';

// NutriSnap MCP Server — exposes food-tracker data to AI assistants via the
// Model Context Protocol over HTTP + SSE.  Auth: x-api-key header (per-user key
// generated from the profile tab in the web UI).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http    = require('http');
const express = require('express');
const path    = require('path');

const { Server }           = require('@modelcontextprotocol/sdk/server/index.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');

const Database = require('better-sqlite3');
const DB_PATH  = process.env.DB_PATH
  || path.join(__dirname, '..', 'data', 'food_tracker.db');

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
} catch (e) {
  console.error('[MCP] Cannot open database at', DB_PATH, '—', e.message);
  console.error('[MCP] Start the main app first so the DB is created.');
  process.exit(1);
}

const MCP_PORT = parseInt(process.env.MCP_PORT || '3001', 10);

const today   = () => new Date().toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

function requireAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'x-api-key header required.' });
  const user = db.prepare('SELECT * FROM users WHERE mcp_api_key = ?').get(key);
  if (!user) return res.status(401).json({ error: 'Invalid API key.' });
  req.mcpUser = user;
  next();
}

function createMcpServer(user) {
  const server = new Server(
    { name: 'nutrisnap', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  server.setRequestHandler({ method: 'tools/list' }, async () => ({
    tools: [
      {
        name: 'get_today_nutrition',
        description: "Get today's food log and calorie totals.",
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_weekly_summary',
        description: 'Get daily nutrition totals for the last N days.',
        inputSchema: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Days to look back (1-30). Default 7.' }
          }
        }
      },
      {
        name: 'log_food_entry',
        description: 'Log a food entry.',
        inputSchema: {
          type: 'object',
          required: ['food_name', 'calories'],
          properties: {
            food_name:  { type: 'string' },
            calories:   { type: 'number' },
            protein:    { type: 'number' },
            carbs:      { type: 'number' },
            fat:        { type: 'number' },
            meal_type:  { type: 'string', description: 'breakfast | lunch | dinner | snack' },
            log_date:   { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' }
          }
        }
      },
      {
        name: 'get_fasting_status',
        description: 'Get the current fasting session and recent fasting history.',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'get_weight_progress',
        description: 'Get the active weight goal and recent weight entries.',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  }));

  server.setRequestHandler({ method: 'tools/call' }, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {

        case 'get_today_nutrition': {
          const logs = db.prepare(
            `SELECT food_name, meal_type, calories, protein, carbs, fat, serving_size
             FROM food_logs WHERE user_id = ? AND log_date = ? ORDER BY id`
          ).all(user.id, today());
          const totals = db.prepare(
            `SELECT ROUND(SUM(calories),0) AS calories, ROUND(SUM(protein),1) AS protein,
                    ROUND(SUM(carbs),1) AS carbs, ROUND(SUM(fat),1) AS fat
             FROM food_logs WHERE user_id = ? AND log_date = ?`
          ).get(user.id, today());
          return ok({ date: today(), calorie_target: user.calorie_target ?? null, totals, meals: logs });
        }

        case 'get_weekly_summary': {
          const days = Math.min(Math.max(parseInt(args.days) || 7, 1), 30);
          const from = daysAgo(days - 1);
          const rows = db.prepare(
            `SELECT log_date, ROUND(SUM(calories),0) AS calories, ROUND(SUM(protein),1) AS protein,
                    ROUND(SUM(carbs),1) AS carbs, ROUND(SUM(fat),1) AS fat, COUNT(*) AS entries
             FROM food_logs WHERE user_id = ? AND log_date BETWEEN ? AND ?
             GROUP BY log_date ORDER BY log_date`
          ).all(user.id, from, today());
          const avgCal = rows.length
            ? Math.round(rows.reduce((s, r) => s + r.calories, 0) / rows.length) : 0;
          return ok({
            period: `${from} to ${today()}`,
            calorie_target: user.calorie_target ?? null,
            days_logged: rows.length, days_requested: days, avg_calories: avgCal, days: rows
          });
        }

        case 'log_food_entry': {
          if (!args.food_name || !args.calories) return err('food_name and calories are required.');
          const result = db.prepare(
            `INSERT INTO food_logs (user_id, log_date, meal_type, food_name, calories, protein, carbs, fat)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            user.id,
            args.log_date  || today(),
            args.meal_type || 'snack',
            args.food_name,
            parseFloat(args.calories) || 0,
            parseFloat(args.protein)  || 0,
            parseFloat(args.carbs)    || 0,
            parseFloat(args.fat)      || 0
          );
          return ok({ success: true, id: result.lastInsertRowid, logged: args.food_name, calories: args.calories });
        }

        case 'get_fasting_status': {
          const active = db.prepare(
            `SELECT *, ROUND((julianday('now') - julianday(started_at)) * 24, 2) AS elapsed_hours
             FROM fasting_sessions WHERE user_id = ? AND status = 'active'`
          ).get(user.id);
          const history = db.prepare(
            `SELECT protocol, actual_hours, target_hours, status, DATE(started_at) AS date, feeling
             FROM fasting_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 10`
          ).all(user.id);
          const stats = db.prepare(
            `SELECT COUNT(*) AS total, ROUND(AVG(actual_hours),1) AS avg_hours, MAX(actual_hours) AS best_hours
             FROM fasting_sessions WHERE user_id = ? AND status = 'completed'`
          ).get(user.id);
          return ok({ active_fast: active || null, stats, recent_history: history });
        }

        case 'get_weight_progress': {
          const goal = db.prepare(
            'SELECT * FROM weight_goals WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1'
          ).get(user.id);
          const logs = db.prepare(
            `SELECT weight, note, DATE(logged_at) AS date FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 20`
          ).all(user.id);
          const latest   = logs[0]?.weight ?? null;
          const daysLeft = goal
            ? Math.max(0, Math.ceil((new Date(goal.target_date) - new Date()) / 86400000)) : null;
          return ok({
            active_goal: goal || null, days_left: daysLeft, latest_weight: latest,
            kg_to_go: goal && latest ? parseFloat((latest - goal.target_weight).toFixed(1)) : null,
            weight_logs: logs
          });
        }

        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return err(e.message);
    }
  });

  server.setRequestHandler({ method: 'resources/list' }, async () => ({
    resources: [{ uri: 'nutrition://today', name: "Today's nutrition", mimeType: 'application/json' }]
  }));

  server.setRequestHandler({ method: 'resources/read' }, async (request) => {
    const { uri } = request.params;
    if (uri !== 'nutrition://today') throw new Error(`Unknown resource: ${uri}`);
    const totals = db.prepare(
      `SELECT ROUND(COALESCE(SUM(calories),0),0) AS calories_eaten
       FROM food_logs WHERE user_id = ? AND log_date = ?`
    ).get(user.id, today());
    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify({ date: today(), calorie_target: user.calorie_target, ...totals }, null, 2)
      }]
    };
  });

  return server;
}

function ok(data) { return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }; }
function err(msg) { return { isError: true, content: [{ type: 'text', text: msg }] }; }

const app        = express();
const transports = {};

app.get('/sse', requireAuth, async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  const mcpServer = createMcpServer(req.mcpUser);
  transports[transport.sessionId] = transport;
  res.on('close', () => { delete transports[transport.sessionId]; });
  await mcpServer.connect(transport);
});

app.post('/messages', requireAuth, express.json(), async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (!transport) return res.status(404).json({ error: 'Session not found. Open /sse first.' });
  await transport.handlePostMessage(req, res, req.body);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'nutrisnap-mcp' }));

http.createServer(app).listen(MCP_PORT, () => {
  console.log(`NutriSnap MCP server on http://localhost:${MCP_PORT}`);
});
