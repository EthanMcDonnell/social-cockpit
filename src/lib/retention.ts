/**
 * How long observability rows are kept.
 *
 * `automation_events` and `schedule_events` are two tables serving the same
 * purpose — a log you read when something looks wrong — and they were each
 * culled against their own private `EVENTS_RETENTION_DAYS = 30`. Two literals
 * with no link between them: halve one and the other quietly keeps a year.
 *
 * A constant rather than configuration. Nothing about the app's behaviour
 * depends on it, and the cost of the wrong value is disk, not correctness — so
 * it is not worth a restart or a settings row. If it ever becomes worth tuning,
 * it belongs in `app_settings` beside the posting policy, not in `.env`.
 */
export const EVENTS_RETENTION_DAYS = 30;
