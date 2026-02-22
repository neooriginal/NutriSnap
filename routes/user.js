'use strict';

const crypto  = require('crypto');
const express = require('express');
const { stmts } = require('../database');

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

function computeStats(user) {
  const { age, weight, height, gender, activity, goal } = user;
  const stats = {};

  if (weight && height) {
    const hm = height / 100;
    stats.bmi = parseFloat((weight / (hm * hm)).toFixed(1));
    stats.bmi_category = bmiCategory(stats.bmi);
  }

  if (age && weight && height && gender) {
    const bmr = gender === 'female'
      ? 10 * weight + 6.25 * height - 5 * age - 161
      : 10 * weight + 6.25 * height - 5 * age + 5;

    const multipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
    const tdee = Math.round(bmr * (multipliers[activity] || 1.55));
    const goalAdjust = { lose: -500, maintain: 0, gain: 300 };

    stats.bmr  = Math.round(bmr);
    stats.tdee = tdee;
    stats.calorie_target = tdee + (goalAdjust[goal] || 0);
  }

  return stats;
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25)   return 'Normal weight';
  if (bmi < 30)   return 'Overweight';
  return 'Obese';
}

module.exports = router;
