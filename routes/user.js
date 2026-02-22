'use strict';

const crypto  = require('crypto');
const express = require('express');
const { stmts } = require('../database');
const { computeStats } = require('../utils');

const router = express.Router();

router.get('/profile', (req, res) => {
  const user = stmts.getUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { password, mcp_api_key, ...safe } = user;
  res.json({ ...safe, ...computeStats(safe), has_mcp_key: !!mcp_api_key });
});

router.put('/profile', express.json(), (req, res) => {
  const { name, age, weight, height, gender, activity, goal } = req.body;
  stmts.updateUser.run({
    id: req.user.id,
    name:     name     || '',
    age:      age      || null,
    weight:   weight   || null,
    height:   height   || null,
    gender:   gender   || 'other',
    activity: activity || 'moderate',
    goal:     goal     || 'maintain'
  });
  const user = stmts.getUserById.get(req.user.id);
  const { password, mcp_api_key, ...safe } = user;
  res.json({ ...safe, ...computeStats(safe), has_mcp_key: !!mcp_api_key });
});

router.get('/mcp-key', (req, res) => {
  const user = stmts.getUserById.get(req.user.id);
  if (!user?.mcp_api_key) return res.json({ key: null });
  const k = user.mcp_api_key;
  res.json({ key: k.slice(0, 8) + '••••••••••••••••' + k.slice(-4) });
});

router.post('/mcp-key', (req, res) => {
  const key = 'ns_' + crypto.randomBytes(24).toString('hex');
  stmts.setMcpKey.run(key, req.user.id);
  res.json({ key });
});

router.delete('/mcp-key', (req, res) => {
  stmts.setMcpKey.run(null, req.user.id);
  res.json({ success: true });
});

module.exports = router;
