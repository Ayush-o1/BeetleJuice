'use strict';

// Development-only accounts. The shared password is public (it is in the README) and must never be
// used anywhere that matters; demo-reset.js refuses to run in production.
const DEMO_PASSWORD = 'BeetleJuice-Demo-2026';
const DEMO_USERS = [
  ['analyst', 'analyst', 'Priya Nair'],
  ['analyst2', 'analyst', 'Rohan Gupta'],
  ['supervisor', 'supervisor', 'Meera Iyer'],
  ['supervisor2', 'supervisor', 'Arjun Rao'],
  ['auditor', 'auditor', 'Kavya Menon'],
];
module.exports = { DEMO_PASSWORD, DEMO_USERS };
