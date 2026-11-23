'use strict';
// Combines the model score (if any) with forensic signals into one verdict.
// Works in log-odds space so strong evidence dominates and weak hints only nudge.

const WEIGHT = {
  ai: { strong: 5, moderate: 1.5, weak: 0.2 },
  real: { strong: -3, moderate: -1, weak: -0.3 },
};

const logit = (p) => Math.log(p / (1 - p));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (p) => Math.min(0.98, Math.max(0.02, p));

function combine({ modelScore = null, signals = [] }) {
  let x = modelScore === null ? 0 : logit(clamp(modelScore));
  for (const s of signals) x += WEIGHT[s.direction]?.[s.strength] || 0;
  const score = sigmoid(x);

  const strongAI = signals.some((s) => s.direction === 'ai' && s.strength === 'strong');
  const strongReal = signals.some((s) => s.direction === 'real' && s.strength === 'strong');
  const anyEvidence = signals.some((s) => (s.direction === 'ai' || s.direction === 'real') && s.strength !== 'weak');

  let label, confidence;
  if (modelScore === null && !strongAI && !strongReal) {
    // Without a model, only hard provenance evidence justifies a firm call.
    label = !anyEvidence ? 'Inconclusive' : score >= 0.5 ? 'Some signs of AI' : 'Some signs of a real capture';
    confidence = 'low';
  } else {
    if (score >= 0.85) label = 'Likely AI-generated';
    else if (score >= 0.6) label = 'Possibly AI-generated';
    else if (score > 0.4) label = 'Inconclusive';
    else if (score > 0.15) label = 'Probably authentic';
    else label = 'Likely authentic';
    confidence = strongAI || strongReal || score >= 0.9 || score <= 0.1 ? 'high'
      : score >= 0.75 || score <= 0.25 ? 'medium' : 'low';
  }
  if (strongAI) label = 'AI-generated (confirmed by embedded metadata)';

  return { score: Math.round(score * 1000) / 1000, label, confidence };
}

module.exports = { combine };
