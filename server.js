'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const auth    = require('./middleware/auth');

const authRoutes    = require('./routes/auth');
const foodRoutes    = require('./routes/food');
const userRoutes    = require('./routes/user');
const goalsRoutes   = require('./routes/goals');
const fastingRoutes = require('./routes/fasting');
const insightsRoutes= require('./routes/insights');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve static files (PWA frontend)
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check (for Docker) ────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/food',     auth, foodRoutes);
app.use('/api/user',     auth, userRoutes);
app.use('/api/goals',    auth, goalsRoutes);
app.use('/api/fasting',  auth, fastingRoutes);
app.use('/api/insights', auth, insightsRoutes);

// ─── SPA Fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🥗  Food Tracker running at http://localhost:${PORT}\n`);
});
