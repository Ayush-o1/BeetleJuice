'use strict';

/**
 * Audit trail. `record` takes the db handle explicitly so callers can pass their open
 * transaction client: the business change and its audit row then commit or roll back together.
 *
 * `actor` is the per-request context { user, ip, requestId } built by the request middleware
 * (user is null for unauthenticated events such as failed logins).
 */
async function record(db, actor, event) {
  const u = actor?.user || null;
  await db.query(
    `INSERT INTO audit_events
       (actor_user_id, actor_username, actor_role, action, entity_type, entity_id,
        related_run_id, related_break_id, context, ip, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      u?.id ?? null, u?.username ?? null, u?.role ?? null,
      event.action, event.entityType, event.entityId == null ? null : String(event.entityId),
      event.relatedRunId ?? null, event.relatedBreakId ?? null,
      JSON.stringify(event.context ?? {}), actor?.ip ?? null, actor?.requestId ?? null,
    ],
  );
}

module.exports = { record };
