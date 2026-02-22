'use strict';

const jwt = require('jsonwebtoken');
const { stmts } = require('../database');

const SECRET = process.env.JWT_SECRET || 'fallback_secret';

function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'Authentication required.' });

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, SECRET);
    const user = stmts.getUserById.get(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = auth;
