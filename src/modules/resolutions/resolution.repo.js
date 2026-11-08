'use strict';

const SELECT = `
  SELECT p.id, p.break_id AS "breakId", p.resolution_code AS "resolutionCode", p.note, p.status, p.break_version AS "breakVersion",
         p.created_at AS "createdAt", p.decided_at AS "decidedAt",
         p.proposed_by AS "proposedById", pu.username AS "proposedBy", pu.display_name AS "proposedByName",
         d.decision, d.note AS "decisionNote", du.username AS "decidedBy", du.display_name AS "decidedByName"
    FROM resolution_proposals p
    JOIN users pu ON pu.id = p.proposed_by
    LEFT JOIN resolution_decisions d ON d.proposal_id = p.id
    LEFT JOIN users du ON du.id = d.decided_by`;

async function listForBreak(db, breakId) {
  return (await db.query(`${SELECT} WHERE p.break_id = $1 ORDER BY p.created_at, p.id`, [breakId])).rows;
}

async function getById(db, id) {
  return (await db.query(`${SELECT} WHERE p.id = $1`, [id])).rows[0] || null;
}

async function lockById(db, id) {
  const { rows } = await db.query(
    'SELECT id, break_id AS "breakId", proposed_by AS "proposedById", resolution_code AS "resolutionCode", status FROM resolution_proposals WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

async function peekBreakId(db, id) {
  const { rows } = await db.query('SELECT break_id AS "breakId" FROM resolution_proposals WHERE id = $1', [id]);
  return rows[0]?.breakId ?? null;
}

async function insert(db, p) {
  const { rows } = await db.query(
    `INSERT INTO resolution_proposals (break_id, proposed_by, resolution_code, note, break_version)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [p.breakId, p.proposedBy, p.resolutionCode, p.note, p.breakVersion]);
  return rows[0].id;
}

async function insertDecision(db, d) {
  await db.query('INSERT INTO resolution_decisions (proposal_id, decided_by, decision, note) VALUES ($1,$2,$3,$4)',
    [d.proposalId, d.decidedBy, d.decision, d.note ?? null]);
}

async function markDecided(db, id, status) {
  await db.query('UPDATE resolution_proposals SET status = $2, decided_at = now() WHERE id = $1', [id, status]);
}

async function listQueue(db, { status, limit, offset }) {
  const params = []; let where = '';
  if (status !== 'all') { params.push(status); where = 'WHERE p.status = $1'; }
  const total = (await db.query(`SELECT count(*)::int AS n FROM resolution_proposals p ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT q.*, b.break_type AS "breakType", b.reference, b.impact_paise AS "impactPaise", b.status AS "breakStatus",
            b.version AS "breakCurrentVersion", b.reference_date AS "referenceDate", b.run_id AS "runId"
       FROM (${SELECT} ${where}) q JOIN breaks b ON b.id = q."breakId"
      ORDER BY (q.status = 'pending') DESC, q."createdAt" ${status === 'pending' ? 'ASC' : 'DESC'}, q.id
      LIMIT ${limit} OFFSET ${offset}`, params);
  return { rows, total };
}

module.exports = { listForBreak, getById, lockById, peekBreakId, insert, insertDecision, markDecided, listQueue };
