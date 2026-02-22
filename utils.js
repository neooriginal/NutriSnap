'use strict';

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

module.exports = { computeStats, bmiCategory };
