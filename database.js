'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'food_tracker.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    age         INTEGER,
    weight      REAL,
    height      REAL,
    gender      TEXT    DEFAULT 'other',
    activity    TEXT    DEFAULT 'moderate',
    goal        TEXT    DEFAULT 'maintain',
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS food_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    log_date     TEXT    NOT NULL DEFAULT (date('now')),
    meal_type    TEXT    DEFAULT 'snack',
    food_name    TEXT    NOT NULL,
    description  TEXT,
    calories     REAL    NOT NULL DEFAULT 0,
    protein      REAL    DEFAULT 0,
    carbs        REAL    DEFAULT 0,
    fat          REAL    DEFAULT 0,
    fiber        REAL    DEFAULT 0,
    serving_size TEXT,
    image_data   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_food_logs_user_date
    ON food_logs(user_id, log_date);

  CREATE TABLE IF NOT EXISTS weight_goals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_weight   REAL    NOT NULL,
    target_weight  REAL    NOT NULL,
    target_date    TEXT    NOT NULL,
    notes          TEXT,
    active         INTEGER NOT NULL DEFAULT 1,
    created_at     TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS weight_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weight     REAL    NOT NULL,
    note       TEXT,
    logged_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fasting_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at      TEXT,
    target_hours  REAL    NOT NULL DEFAULT 16,
    actual_hours  REAL,
    protocol      TEXT    DEFAULT '16:8',
    status        TEXT    NOT NULL DEFAULT 'active',
    feeling       TEXT,
    note          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_fasting_user_status
    ON fasting_sessions(user_id, status);

  CREATE INDEX IF NOT EXISTS idx_weight_logs_user
    ON weight_logs(user_id, logged_at);
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const stmts = {
  // Users
  createUser: db.prepare(`
    INSERT INTO users (name, email, password, age, weight, height, gender, activity, goal)
    VALUES (@name, @email, @password, @age, @weight, @height, @gender, @activity, @goal)
  `),
  getUserByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getUserById:    db.prepare(`SELECT * FROM users WHERE id = ?`),
  updateUser: db.prepare(`
    UPDATE users
    SET name=@name, age=@age, weight=@weight, height=@height,
        gender=@gender, activity=@activity, goal=@goal
    WHERE id=@id
  `),

  // Food logs
  insertLog: db.prepare(`
    INSERT INTO food_logs (user_id, log_date, meal_type, food_name, description,
                           calories, protein, carbs, fat, fiber, serving_size, image_data)
    VALUES (@user_id, @log_date, @meal_type, @food_name, @description,
            @calories, @protein, @carbs, @fat, @fiber, @serving_size, @image_data)
  `),
  getLogsByDate: db.prepare(`
    SELECT * FROM food_logs
    WHERE user_id = ? AND log_date = ?
    ORDER BY logged_at ASC
  `),
  getLogsRange: db.prepare(`
    SELECT log_date,
           SUM(calories) AS total_calories,
           SUM(protein)  AS total_protein,
           SUM(carbs)    AS total_carbs,
           SUM(fat)      AS total_fat
    FROM food_logs
    WHERE user_id = ? AND log_date BETWEEN ? AND ?
    GROUP BY log_date
    ORDER BY log_date ASC
  `),
  deleteLog: db.prepare(`DELETE FROM food_logs WHERE id = ? AND user_id = ?`),
  getTodayTotals: db.prepare(`
    SELECT
      COALESCE(SUM(calories),0) AS calories,
      COALESCE(SUM(protein),0)  AS protein,
      COALESCE(SUM(carbs),0)    AS carbs,
      COALESCE(SUM(fat),0)      AS fat,
      COALESCE(SUM(fiber),0)    AS fiber
    FROM food_logs
    WHERE user_id = ? AND log_date = ?
  `),

  // Fasting
  getActiveFast: db.prepare(`
    SELECT *,
      ROUND((julianday('now') - julianday(started_at)) * 24, 2) AS elapsed_hours
    FROM fasting_sessions WHERE user_id = ? AND status = 'active'
  `)
};

module.exports = { db, stmts };
