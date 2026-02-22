'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { stmts } = require('../database');

const router = express.Router();
const SECRET = process.env.JWT_SECRET;

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, email, password, age, weight, height, gender, activity, goal } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });

  const existing = stmts.getUserByEmail.get(email);
  if (existing)
    return res.status(409).json({ error: 'Email already in use.' });

  const hash = bcrypt.hashSync(password, 10);
  const result = stmts.createUser.run({
    name, email, password: hash,
    age:      age      || null,
    weight:   weight   || null,
    height:   height   || null,
    gender:   gender   || 'other',
    activity: activity || 'moderate',
    goal:     goal     || 'maintain'
  });

  const user = stmts.getUserById.get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });

  res.json({ token, user: sanitize(user) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required.' });

  const user = stmts.getUserByEmail.get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials.' });

  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitize(user) });
});

function sanitize(u) {
  const { password, ...safe } = u;
  return safe;
}

module.exports = router;
