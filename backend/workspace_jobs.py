import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from backend.database import get_connection as open_connection


@contextmanager
def get_connection():
    connection = open_connection()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def parse_time(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Use an RFC3339 timestamp with a timezone offset.")
    return parsed.astimezone(timezone.utc)


def init_jobs():
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS workspace_jobs (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
                status TEXT NOT NULL, run_at TEXT NOT NULL, cron_expression TEXT,
                time_zone TEXT, created_at TEXT NOT NULL, last_error TEXT,
                last_result TEXT, account_email TEXT
            )
        """)
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(workspace_jobs)")}
        if "account_email" not in columns:
            connection.execute("ALTER TABLE workspace_jobs ADD COLUMN account_email TEXT")
        connection.execute("CREATE INDEX IF NOT EXISTS workspace_jobs_due ON workspace_jobs(status, run_at)")
        connection.execute("UPDATE workspace_jobs SET status='paused', last_error='Restart during execution/setup; inspect provider state before cancelling or recreating.' WHERE status IN ('running', 'preparing', 'cancelling')")
        connection.execute("UPDATE staged_actions SET status='failed', result=? WHERE status='executing'", (json.dumps({"error": "Restart during approval execution. Delivery may have occurred; inspect Gmail and workspace jobs before sending again."}),))


def validate_schedule(cron_expression, time_zone):
    from zoneinfo import ZoneInfo
    from backend.scheduler import compute_next_run

    ZoneInfo(time_zone)
    if len(cron_expression.split()) != 5:
        raise ValueError("Use a five-field cron expression.")
    run_at = compute_next_run(cron_expr=cron_expression, timezone_str=time_zone)
    if not run_at:
        raise ValueError("Invalid recurrence schedule.")
    return {"cron_expression": cron_expression, "time_zone": time_zone, "run_at": run_at}


def create_job(kind, payload, run_at, cron_expression=None, time_zone=None, job_id=None, status="pending", account_email=None):
    if kind not in ("task_recurrence", "gmail_wake", "gmail_send"):
        raise ValueError("Unsupported workspace job kind.")
    when = parse_time(run_at)
    if when <= datetime.now(timezone.utc):
        raise ValueError("Scheduled times must be in the future.")
    identifier = job_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    prepared = dict(payload)
    if kind == "task_recurrence":
        if not cron_expression or not time_zone:
            raise ValueError("Recurring tasks require a cron expression and timezone.")
        validate_schedule(cron_expression, time_zone)
        from zoneinfo import ZoneInfo
        prepared["template_date"] = datetime.now(ZoneInfo(time_zone)).date().isoformat()
    with get_connection() as connection:
        connection.execute("INSERT OR IGNORE INTO workspace_jobs (id, kind, payload, status, run_at, cron_expression, time_zone, created_at, account_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (identifier, kind, json.dumps(prepared), status, when.isoformat(), cron_expression, time_zone, now, account_email))
    return get_job(identifier)


def get_job(job_id):
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM workspace_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise ValueError("Workspace job not found.")
    job = dict(row)
    job["payload"] = json.loads(job["payload"])
    job["last_result"] = json.loads(job["last_result"]) if job["last_result"] else None
    return job


def list_jobs():
    with get_connection() as connection:
        identifiers = [row["id"] for row in connection.execute("SELECT id FROM workspace_jobs ORDER BY created_at DESC LIMIT 100")]
    return [get_job(identifier) for identifier in identifiers]


def activate_job(job_id):
    with get_connection() as connection:
        connection.execute("UPDATE workspace_jobs SET status='pending' WHERE id=? AND status='preparing'", (job_id,))
    return get_job(job_id)


def pause_job(job_id, reason):
    with get_connection() as connection:
        connection.execute("UPDATE workspace_jobs SET status='paused', last_error=? WHERE id=?", (reason, job_id))


def cancel_job(job_id, service):
    job = get_job(job_id)
    if job["kind"] == "gmail_wake" and job.get("account_email") and job["account_email"] != service.get_user_email():
        raise ValueError("Reconnect the snoozed thread's original Google account before restoring its inbox.")
    with get_connection() as connection:
        claimed = connection.execute("UPDATE workspace_jobs SET status='cancelling' WHERE id=? AND status IN ('pending', 'paused')", (job_id,)).rowcount
    job = get_job(job_id)
    if not claimed:
        if job["status"] == "cancelled":
            return job
        raise ValueError("Only pending or paused jobs can be cancelled; an executing delivery cannot be recalled.")
    try:
        if job["kind"] == "gmail_wake":
            service.modify_mail(job["payload"]["thread_id"], "thread", "labels", add_labels=["INBOX"])
        with get_connection() as connection:
            connection.execute("UPDATE workspace_jobs SET status='cancelled' WHERE id=?", (job_id,))
    except Exception as error:
        pause_job(job_id, f"Cancellation/restore failed: {error}")
        raise
    return get_job(job_id)


def run_due(service, now=None):
    from zoneinfo import ZoneInfo
    from backend.scheduler import compute_next_run

    current = now or datetime.now(timezone.utc)
    with get_connection() as connection:
        identifiers = [row["id"] for row in connection.execute("SELECT id FROM workspace_jobs WHERE status='pending' AND run_at<=? ORDER BY run_at LIMIT 20", (current.isoformat(),))]
    for identifier in identifiers:
        with get_connection() as connection:
            claimed = connection.execute("UPDATE workspace_jobs SET status='running' WHERE id=? AND status='pending'", (identifier,)).rowcount
        if not claimed:
            continue
        job = get_job(identifier)
        try:
            if job.get("account_email") and job["account_email"] != service.get_user_email():
                raise ValueError("Connected Google account differs from this job's owner. Reconnect the original account and recreate after inspecting provider state.")
            payload = dict(job["payload"])
            if job["kind"] == "gmail_send":
                result = service.send_email(**payload)
            elif job["kind"] == "gmail_wake":
                result = service.modify_mail(payload["thread_id"], "thread", "labels", add_labels=["INBOX"])
            else:
                template_date = datetime.strptime(payload.pop("template_date"), "%Y-%m-%d").date()
                occurrence_date = current.astimezone(ZoneInfo(job["time_zone"])).date()
                shift = occurrence_date - template_date
                for key in ("due", "start_at", "due_at"):
                    if payload.get(key):
                        value = payload[key]
                        if key == "due":
                            payload[key] = (datetime.strptime(value, "%Y-%m-%d") + shift).date().isoformat()
                        else:
                            payload[key] = (datetime.fromisoformat(value.replace("Z", "+00:00")) + shift).isoformat()
                result = service.create_task(**payload)
                if result.get("partial_error"):
                    raise RuntimeError(result["partial_error"])
            if job["cron_expression"]:
                next_run = compute_next_run(cron_expr=job["cron_expression"], timezone_str=job["time_zone"], base_dt=current)
                status = "pending"
            else:
                next_run, status = job["run_at"], "completed"
            with get_connection() as connection:
                connection.execute("UPDATE workspace_jobs SET status=?, run_at=?, last_result=?, last_error=NULL WHERE id=? AND status='running'", (status, next_run, json.dumps(result), identifier))
        except Exception as error:
            pause_job(identifier, f"Execution failed or delivery uncertain; no automatic retry: {error}")
