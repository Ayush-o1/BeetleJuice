'use strict';

/**
 * Single source of truth for who may do what. Routes call requirePermission(...) with one of
 * these names; the frontend receives the caller's list only to decide which controls to show.
 * Hiding a button is cosmetic; every one of these is enforced again on the server.
 */
const ALL = ['analyst', 'supervisor', 'auditor'];

const PERMISSIONS = Object.freeze({
  'overview:read': ALL,
  'sources:read': ALL,
  'sources:upload': ['analyst'],
  'runs:read': ALL,
  'runs:create': ['analyst'],
  'breaks:read': ALL,
  'breaks:note': ['analyst'],
  'proposals:read': ALL,
  'proposals:create': ['analyst'],
  'proposals:decide': ['supervisor'],
  'settings:read': ALL,
  'settings:update': ['supervisor'],
  'audit:read': ['supervisor', 'auditor'],
});

const can = (role, permission) => Boolean(PERMISSIONS[permission]?.includes(role));
const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => can(role, p));

module.exports = { PERMISSIONS, can, permissionsFor };
