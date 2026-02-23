'use strict';

require('dotenv').config();

const express = require('express');
const path    = require('path');
const auth    = require('./middleware/auth');

const authRoutes     = require('./routes/auth');
const foodRoutes     = require('./routes/food');
const userRoutes     = require('./routes/user');
const goalsRoutes    = require('./routes/goals');
const fastingRoutes  = require('./routes/fasting');
const insightsRoutes = require('./routes/insights');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.removeHeader('X-Powered-By');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth',     authRoutes);
app.use('/api/food',     auth, foodRoutes);
app.use('/api/user',     auth, userRoutes);
app.use('/api/goals',    auth, goalsRoutes);
app.use('/api/fasting',  auth, fastingRoutes);
app.use('/api/insights', auth, insightsRoutes);

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`NutriSnap running at http://localhost:${PORT}`);
});

