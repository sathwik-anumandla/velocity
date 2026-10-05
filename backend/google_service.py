"""
Velocity Google Workspace Service
Implements Google OAuth 2.0 and API integration for:
- Google Calendar v3 (list events, create event, delete event)
- Google Tasks v1 (list tasks, create task, complete task)
- Gmail v1 (list unread digests, create draft, send email)

Strict design constraint: ZERO EMOJIS across all code, strings, and logs.
"""

import os
import json
import base64
import logging
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

from backend.database import (
    save_integration_token,
    get_integration_token,
    delete_integration_token,
)

logger = logging.getLogger("velocity.google_service")

GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/tasks",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

CREDENTIALS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "credentials")
TOKEN_FILE_PATH = os.path.join(CREDENTIALS_DIR, "google_token.json")
CREDENTIALS_FILE_PATH = os.path.join(CREDENTIALS_DIR, "credentials.json")


class GoogleWorkspaceService:
    def __init__(self):
        os.makedirs(CREDENTIALS_DIR, exist_ok=True)

    def _get_client_config(self) -> Optional[Dict[str, Any]]:
        """
        Loads Google OAuth client configuration from environment variables
        or data/credentials/credentials.json.
        """
        try:
            from dotenv import load_dotenv
            load_dotenv(override=True)
            env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
            if os.path.isfile(env_file):
                load_dotenv(env_file, override=True)
        except Exception as e:
            logger.debug(f"dotenv reload exception: {e}")

        client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
        redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback").strip()

        if client_id and client_secret:
            return {
                "web": {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": [redirect_uri],
                }
            }

        if os.path.isfile(CREDENTIALS_FILE_PATH):
            try:
                with open(CREDENTIALS_FILE_PATH, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to read credentials.json: {e}")

        return None

    def get_auth_url(self, redirect_uri: Optional[str] = None, state: Optional[str] = None) -> str:
        """
        Generates Google OAuth 2.0 authorization URL.
        """
        client_config = self._get_client_config()
        if not client_config:
            raise ValueError(
                "Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and "
                "GOOGLE_CLIENT_SECRET in .env or provide data/credentials/credentials.json."
            )

        if not redirect_uri:
            redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback").strip()

        flow = Flow.from_client_config(
            client_config,
            scopes=GOOGLE_SCOPES,
            redirect_uri=redirect_uri,
            autogenerate_code_verifier=False,
        )

        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return auth_url

    def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        """
        Exchanges authorization code for tokens and persists them.
        """
        client_config = self._get_client_config()
        if not client_config:
            raise ValueError("Google OAuth credentials not configured.")

        if not redirect_uri:
            redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback").strip()

        flow = Flow.from_client_config(
            client_config,
            scopes=GOOGLE_SCOPES,
            redirect_uri=redirect_uri,
            autogenerate_code_verifier=False,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        # Fetch user email using oauth2 userinfo
        user_email = None
        try:
            oauth_svc = build("oauth2", "v2", credentials=creds)
            user_info = oauth_svc.userinfo().get().execute()
            user_email = user_info.get("email")
        except Exception as e:
            logger.warning(f"Could not fetch user email: {e}")

        expires_at_iso = creds.expiry.isoformat() if creds.expiry else None
        scopes_str = " ".join(creds.scopes) if creds.scopes else " ".join(GOOGLE_SCOPES)
        metadata = {"email": user_email} if user_email else {}

        # Save to database
        saved = save_integration_token(
            provider="google",
            access_token=creds.token,
            refresh_token=creds.refresh_token,
            expires_at=expires_at_iso,
            scopes=scopes_str,
            metadata=metadata,
        )

        # Mirror to token file
        token_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
            "expiry": expires_at_iso,
            "email": user_email,
        }
        try:
            with open(TOKEN_FILE_PATH, "w", encoding="utf-8") as f:
                json.dump(token_data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to mirror google_token.json: {e}")

        return saved

    def get_credentials(self) -> Optional[Credentials]:
        """
        Retrieves valid Credentials object, automatically refreshing if expired.
        """
        token_row = get_integration_token("google")
        client_config = self._get_client_config()

        client_id = None
        client_secret = None
        token_uri = "https://oauth2.googleapis.com/token"

        if client_config:
            cfg = client_config.get("web") or client_config.get("installed") or {}
            client_id = cfg.get("client_id")
            client_secret = cfg.get("client_secret")
            token_uri = cfg.get("token_uri", token_uri)

        access_token = None
        refresh_token = None
        expiry = None
        scopes = GOOGLE_SCOPES

        if token_row:
            access_token = token_row.get("access_token")
            refresh_token = token_row.get("refresh_token")
            expires_at_str = token_row.get("expires_at")
            if expires_at_str:
                try:
                    expiry = datetime.fromisoformat(expires_at_str)
                    if expiry.tzinfo is not None:
                        expiry = expiry.replace(tzinfo=None)
                except Exception:
                    pass
            if token_row.get("scopes"):
                scopes = token_row["scopes"].split()

        # Fallback to token file if DB empty
        elif os.path.isfile(TOKEN_FILE_PATH):
            try:
                with open(TOKEN_FILE_PATH, "r", encoding="utf-8") as f:
                    file_data = json.load(f)
                access_token = file_data.get("token")
                refresh_token = file_data.get("refresh_token")
                client_id = file_data.get("client_id") or client_id
                client_secret = file_data.get("client_secret") or client_secret
                token_uri = file_data.get("token_uri", token_uri)
                if file_data.get("expiry"):
                    try:
                        expiry = datetime.fromisoformat(file_data["expiry"]).replace(tzinfo=None)
                    except Exception:
                        pass
                if file_data.get("scopes"):
                    scopes = file_data["scopes"]
            except Exception as e:
                logger.error(f"Error loading {TOKEN_FILE_PATH}: {e}")

        if not access_token and not refresh_token:
            return None

        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri=token_uri,
            client_id=client_id,
            client_secret=client_secret,
            scopes=scopes,
            expiry=expiry,
        )

        # Refresh if expired and refresh token available
        if creds.expired and creds.refresh_token:
            try:
                logger.info("Google credentials expired. Refreshing token...")
                creds.refresh(Request())
                expires_at_iso = creds.expiry.isoformat() if creds.expiry else None

                save_integration_token(
                    provider="google",
                    access_token=creds.token,
                    refresh_token=creds.refresh_token,
                    expires_at=expires_at_iso,
                    scopes=" ".join(creds.scopes) if creds.scopes else None,
                )

                if os.path.isfile(TOKEN_FILE_PATH):
                    try:
                        with open(TOKEN_FILE_PATH, "r", encoding="utf-8") as f:
                            file_data = json.load(f)
                        file_data["token"] = creds.token
                        if creds.refresh_token:
                            file_data["refresh_token"] = creds.refresh_token
                        file_data["expiry"] = expires_at_iso
                        with open(TOKEN_FILE_PATH, "w", encoding="utf-8") as f:
                            json.dump(file_data, f, indent=2)
                    except Exception as fe:
                        logger.warning(f"Could not update {TOKEN_FILE_PATH}: {fe}")
            except Exception as re:
                logger.error(f"Failed to refresh Google credentials: {re}")
                return None

        return creds

    def is_connected(self) -> bool:
        """
        Returns True if Google Workspace credentials exist and are active.
        """
        creds = self.get_credentials()
        return creds is not None and creds.valid

    def get_user_email(self) -> Optional[str]:
        """
        Returns the connected Google user email address.
        """
        token_row = get_integration_token("google")
        if token_row and token_row.get("metadata"):
            meta = token_row["metadata"]
            if isinstance(meta, dict) and meta.get("email"):
                return meta["email"]

        if os.path.isfile(TOKEN_FILE_PATH):
            try:
                with open(TOKEN_FILE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("email"):
                        return data["email"]
            except Exception:
                pass

        creds = self.get_credentials()
        if creds and creds.valid:
            try:
                oauth_svc = build("oauth2", "v2", credentials=creds)
                info = oauth_svc.userinfo().get().execute()
                email = info.get("email")
                if email:
                    save_integration_token(
                        provider="google",
                        access_token=creds.token,
                        refresh_token=creds.refresh_token,
                        metadata={"email": email},
                    )
                return email
            except Exception:
                pass
        return None

    def disconnect(self) -> bool:
        """
        Revokes credentials and deletes stored tokens from DB and disk.
        """
        creds = self.get_credentials()
        if creds:
            try:
                import requests
                requests.post(
                    "https://oauth2.googleapis.com/revoke",
                    params={"token": creds.token},
                    headers={"content-type": "application/x-www-form-urlencoded"},
                    timeout=5,
                )
            except Exception as e:
                logger.warning(f"Revoke call failed: {e}")

        delete_integration_token("google")
        if os.path.isfile(TOKEN_FILE_PATH):
            try:
                os.remove(TOKEN_FILE_PATH)
            except Exception as e:
                logger.warning(f"Failed to delete {TOKEN_FILE_PATH}: {e}")
        return True

    # ==========================================================================
    # Google Calendar Operations
    # ==========================================================================

    def _service(self, api, version):
        credentials = self.get_credentials()
        if not credentials:
            raise RuntimeError("Google Workspace is disconnected. Connect via Settings -> Plugins.")
        return build(api, version, credentials=credentials)

    def _job_account(self):
        email = self.get_user_email()
        if not email:
            raise ValueError("Cannot identify the connected Google account. Reconnect before scheduling an action.")
        return email

    def list_calendar_events(self, time_min=None, time_max=None, max_results=10, calendar_id="primary", query=None):
        arguments = {
            "calendarId": calendar_id, "timeMin": time_min or datetime.now(timezone.utc).isoformat(),
            "timeMax": time_max or (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "maxResults": max_results, "singleEvents": True, "orderBy": "startTime",
        }
        if query:
            arguments["q"] = query
        result = self._service("calendar", "v3").events().list(**arguments).execute()
        return [self._calendar_result(event, calendar_id) for event in result.get("items", [])]

    def list_calendars(self):
        service = self._service("calendar", "v3")
        items, token = [], None
        while True:
            arguments = {"pageToken": token} if token else {}
            page = service.calendarList().list(**arguments).execute()
            items.extend({key: item.get(key) for key in ("id", "summary", "primary", "accessRole", "timeZone")} for item in page.get("items", []))
            token = page.get("nextPageToken")
            if not token:
                return items

    @staticmethod
    def _calendar_result(event, calendar_id):
        result = {key: event.get(key) for key in (
            "id", "summary", "description", "location", "recurrence", "reminders",
            "visibility", "transparency", "colorId", "guestsCanModify", "guestsCanInviteOthers",
            "guestsCanSeeOtherGuests", "status",
        )}
        result.update({
            "calendar_id": calendar_id,
            "start": event.get("start", {}).get("dateTime") or event.get("start", {}).get("date"),
            "end": event.get("end", {}).get("dateTime") or event.get("end", {}).get("date"),
            "html_link": event.get("htmlLink"),
            "attendees": [attendee.get("email") for attendee in event.get("attendees", [])],
            "meet_link": next((entry.get("uri") for entry in event.get("conferenceData", {}).get("entryPoints", []) if entry.get("entryPointType") == "video"), None),
        })
        return result

    @staticmethod
    def _calendar_body(fields, creating=False):
        from zoneinfo import ZoneInfo
        import uuid

        body = {}
        zone = fields.get("time_zone")
        if zone:
            ZoneInfo(zone)
        for argument, target in (("start_time", "start"), ("end_time", "end")):
            value = fields.get(argument)
            if value is not None:
                if "T" in value:
                    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    if parsed.tzinfo is None and not zone:
                        raise ValueError("Timed events require an offset or an explicit IANA time_zone.")
                    body[target] = {"dateTime": value}
                    if zone:
                        body[target]["timeZone"] = zone
                else:
                    datetime.strptime(value, "%Y-%m-%d")
                    body[target] = {"date": value}
        if "start" in body and "end" in body:
            if ("date" in body["start"]) != ("date" in body["end"]):
                raise ValueError("Start and end must both be dates or both timestamps.")
            start_value = fields["start_time"]
            end_value = fields["end_time"]
            start = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_value.replace("Z", "+00:00"))
            if (start.tzinfo is None) != (end.tzinfo is None) or end <= start:
                raise ValueError("Event end must be after its start with compatible timezone offsets.")
        recurrence = fields.get("recurrence")
        if recurrence:
            if any(not entry.startswith(("RRULE:", "RDATE:", "EXDATE:")) for entry in recurrence):
                raise ValueError("Recurrence accepts only RRULE, RDATE and EXDATE lines.")
            if creating and "dateTime" in body.get("start", {}) and not zone:
                raise ValueError("Recurring timed events require an IANA time_zone.")
        for key in ("summary", "description", "location", "recurrence", "reminders", "visibility", "colorId", "guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests"):
            if key in fields and fields[key] is not None:
                body[key] = fields[key]
        if "attendees" in fields and fields["attendees"] is not None:
            body["attendees"] = [{"email": email} for email in fields["attendees"]]
        if "showAs" in fields:
            if fields["showAs"] not in ("busy", "free"):
                raise ValueError("showAs must be busy or free.")
            body["transparency"] = "opaque" if fields["showAs"] == "busy" else "transparent"
        if fields.get("add_meet", creating):
            body["conferenceData"] = {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
        return body

    def create_calendar_event(self, summary, start_time, end_time, description=None, attendees=None, add_meet=True, **options):
        fields = {**options, "summary": summary, "start_time": start_time, "end_time": end_time, "description": description, "attendees": attendees, "add_meet": add_meet}
        body = self._calendar_body(fields, creating=True)
        calendar_id = options.get("calendar_id", "primary")
        result = self._service("calendar", "v3").events().insert(
            calendarId=calendar_id, body=body, conferenceDataVersion=1 if add_meet else 0,
            sendUpdates=options.get("send_updates", "none"),
        ).execute()
        return self._calendar_result(result, calendar_id)

    def update_calendar_event(self, event_id, calendar_id="primary", **fields):
        service = self._service("calendar", "v3")
        body = self._calendar_body(fields)
        if not body:
            raise ValueError("Supply at least one event field to update.")
        current = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        merged = dict(current)
        merged.update(body)
        start = merged.get("start", {})
        end = merged.get("end", {})
        validation = {
            "start_time": start.get("dateTime") or start.get("date"),
            "end_time": end.get("dateTime") or end.get("date"),
            "time_zone": fields.get("time_zone") or start.get("timeZone"),
            "recurrence": merged.get("recurrence"),
        }
        self._calendar_body(validation, creating=True)
        updated = service.events().patch(calendarId=calendar_id, eventId=event_id, body=body, conferenceDataVersion=1, sendUpdates=fields.get("send_updates", "none")).execute()
        return self._calendar_result(updated, calendar_id)

    def delete_calendar_event(self, event_id, calendar_id="primary"):
        self._service("calendar", "v3").events().delete(calendarId=calendar_id, eventId=event_id).execute()
        return {"id": event_id, "calendar_id": calendar_id, "status": "deleted"}

    @staticmethod
    def _task_notes(notes, fields, existing=None):
        marker = "\n\n[Velocity metadata]\n"
        metadata = dict(existing or {})
        text = notes or ""
        if marker in text:
            text, raw = text.rsplit(marker, 1)
            try:
                metadata.update(json.loads(raw))
            except (ValueError, TypeError):
                raise ValueError("Task notes contain invalid Velocity metadata.")
        for key in ("priority", "labels", "start_at", "due_at"):
            if key in fields:
                metadata[key] = fields[key]
        for key in ("start_at", "due_at"):
            if metadata.get(key):
                from backend.workspace_jobs import parse_time
                parse_time(metadata[key])
        if metadata.get("priority") and metadata["priority"] not in ("low", "normal", "high", "urgent"):
            raise ValueError("Invalid task priority.")
        return text + (marker + json.dumps(metadata, ensure_ascii=False) if metadata else "")

    @staticmethod
    def _task_result(task):
        result = dict(task)
        marker = "\n\n[Velocity metadata]\n"
        if marker in task.get("notes", ""):
            notes, raw = task["notes"].rsplit(marker, 1)
            try:
                result["velocity_metadata"] = json.loads(raw)
                result["notes"] = notes
            except ValueError:
                pass
        return result

    def list_tasklists(self):
        service = self._service("tasks", "v1")
        items, token = [], None
        while True:
            arguments = {"maxResults": 1000}
            if token:
                arguments["pageToken"] = token
            page = service.tasklists().list(**arguments).execute()
            items.extend(page.get("items", []))
            token = page.get("nextPageToken")
            if not token:
                return items

    def list_tasks(self, include_completed=False, due_max=None, tasklist_id="@default", due_min=None, page_token=None, max_results=100):
        arguments = {"tasklist": tasklist_id, "showCompleted": include_completed, "showHidden": include_completed, "maxResults": max_results}
        for key, value in (("dueMax", due_max), ("dueMin", due_min), ("pageToken", page_token)):
            if value:
                arguments[key] = value
        page = self._service("tasks", "v1").tasks().list(**arguments).execute()
        return {"tasks": [self._task_result(task) for task in page.get("items", [])], "next_page_token": page.get("nextPageToken")}

    def create_task(self, title, notes=None, due=None, tasklist_id="@default", parent=None, subtasks=None, recurrence=None, **fields):
        from backend import workspace_jobs

        prepared = {"title": title, "notes": self._task_notes(notes, fields)}
        due_date = due or (fields.get("due_at") or "")[:10]
        if due_date:
            datetime.strptime(due_date, "%Y-%m-%d")
            if fields.get("due_at") and due_date != fields["due_at"][:10]:
                raise ValueError("due and due_at must specify the same local date.")
            prepared["due"] = due_date + "T00:00:00.000Z"
        job_options = None
        if recurrence:
            job_options = workspace_jobs.validate_schedule(recurrence["cron_expression"], recurrence["time_zone"])
            job_options["account_email"] = self._job_account()
        if parent and subtasks:
            raise ValueError("Google Tasks supports one subtask level; a subtask cannot contain more subtasks.")
        service = self._service("tasks", "v1")
        arguments = {"tasklist": tasklist_id, "body": prepared}
        if parent:
            arguments["parent"] = parent
        created = service.tasks().insert(**arguments).execute()
        result = self._task_result(created)
        result["tasklist_id"] = tasklist_id
        if subtasks:
            result["subtasks"] = []
            for title in subtasks:
                try:
                    child = service.tasks().insert(tasklist=tasklist_id, parent=created["id"], body={"title": title}).execute()
                    result["subtasks"].append(self._task_result(child))
                except Exception as error:
                    result["partial_error"] = f"Parent created; some subtasks failed: {error}. Do not recreate the parent."
                    break
        if job_options:
            template = {"title": prepared["title"], "notes": notes, "tasklist_id": tasklist_id, "parent": parent, "subtasks": subtasks, **fields}
            template["due"] = due_date or None
            try:
                result["recurrence_job"] = workspace_jobs.create_job("task_recurrence", template, **job_options)
            except Exception as error:
                result["partial_error"] = f"Task created, but recurrence could not be saved: {error}"
        return result

    def update_task(self, task_id, tasklist_id="@default", **fields):
        service = self._service("tasks", "v1")
        current = service.tasks().get(tasklist=tasklist_id, task=task_id).execute()
        body = {key: fields[key] for key in ("title", "status") if key in fields}
        if "status" in body and body["status"] not in ("needsAction", "completed"):
            raise ValueError("Invalid task status.")
        previous = self._task_result(current).get("velocity_metadata", {})
        if any(key in fields for key in ("notes", "priority", "labels", "start_at", "due_at")):
            body["notes"] = self._task_notes(fields.get("notes", self._task_result(current).get("notes", "")), fields, previous)
        if "due" in fields or "due_at" in fields:
            due = fields.get("due") or (fields.get("due_at") or "")[:10]
            if due:
                datetime.strptime(due, "%Y-%m-%d")
                if fields.get("due_at") and due != fields["due_at"][:10]:
                    raise ValueError("due and due_at must specify the same date.")
            body["due"] = due + "T00:00:00.000Z" if due else None
        if not body:
            raise ValueError("Supply at least one task field to update.")
        return self._task_result(service.tasks().patch(tasklist=tasklist_id, task=task_id, body=body).execute())

    def complete_task(self, task_id, tasklist_id="@default"):
        updated = self._service("tasks", "v1").tasks().patch(tasklist=tasklist_id, task=task_id, body={"status": "completed"}).execute()
        return self._task_result(updated)

    def list_unread_emails(self, query="is:unread category:primary", max_results=5, page_token=None):
        service = self._service("gmail", "v1")
        arguments = {"userId": "me", "q": query, "maxResults": max_results}
        if page_token:
            arguments["pageToken"] = page_token
        page = service.users().messages().list(**arguments).execute()
        emails = []
        for item in page.get("messages", []):
            message = service.users().messages().get(userId="me", id=item["id"], format="metadata", metadataHeaders=["From", "Subject", "Date"]).execute()
            headers = {header["name"].lower(): header["value"] for header in message.get("payload", {}).get("headers", [])}
            emails.append({"id": message["id"], "thread_id": message.get("threadId"), "from": headers.get("from"), "subject": headers.get("subject"), "date": headers.get("date"), "snippet": message.get("snippet"), "labels": message.get("labelIds", [])})
        return {"messages": emails, "next_page_token": page.get("nextPageToken")}

    def get_thread(self, thread_id, max_messages=10):
        thread = self._service("gmail", "v1").users().threads().get(userId="me", id=thread_id, format="full").execute()

        def text_parts(payload):
            parts = []
            if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
                encoded = payload["body"]["data"]
                parts.append(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8", errors="replace"))
            for part in payload.get("parts", []):
                parts.extend(text_parts(part))
            return parts

        messages = []
        for message in thread.get("messages", [])[-max_messages:]:
            headers = {header["name"].lower(): header["value"] for header in message.get("payload", {}).get("headers", [])}
            text = "\n".join(text_parts(message.get("payload", {})))
            messages.append({"id": message["id"], "headers": headers, "rfc_message_id": headers.get("message-id"), "labels": message.get("labelIds", []), "body": text[:8000] or message.get("snippet", ""), "body_truncated": len(text) > 8000})
        return {"thread_id": thread_id, "messages": messages, "messages_truncated": len(thread.get("messages", [])) > max_messages}

    def list_labels(self):
        return self._service("gmail", "v1").users().labels().list(userId="me").execute().get("labels", [])

    def create_label(self, name):
        return self._service("gmail", "v1").users().labels().create(userId="me", body={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}).execute()

    def modify_mail(self, target_id, target_kind, action, add_labels=None, remove_labels=None):
        mapping = {"archive": ([], ["INBOX"]), "mark_read": ([], ["UNREAD"]), "mark_unread": (["UNREAD"], []), "star": (["STARRED"], []), "unstar": ([], ["STARRED"]), "trash": (["TRASH"], ["INBOX"]), "untrash": ([], ["TRASH"]), "labels": ([], [])}
        if action not in mapping or target_kind not in ("message", "thread"):
            raise ValueError("Invalid Gmail action or target kind.")
        add, remove = mapping[action]
        if action == "labels":
            add, remove = add_labels or [], remove_labels or []
            if not add and not remove:
                raise ValueError("Supply labels to add or remove.")
        elif add_labels or remove_labels:
            raise ValueError("Custom label changes require action=labels.")
        if set(add) & set(remove):
            raise ValueError("The same label cannot be added and removed.")
        users = self._service("gmail", "v1").users()
        resource = users.threads() if target_kind == "thread" else users.messages()
        if action in ("trash", "untrash"):
            operation = resource.trash if action == "trash" else resource.untrash
            return operation(userId="me", id=target_id).execute()
        return resource.modify(userId="me", id=target_id, body={"addLabelIds": add, "removeLabelIds": remove}).execute()

    @staticmethod
    def _mail_payload(to, subject, body, cc=None, bcc=None, thread_id=None, in_reply_to=None):
        if bool(thread_id) != bool(in_reply_to):
            raise ValueError("Reply threading requires both thread_id and RFC in_reply_to.")
        message = EmailMessage()
        message.set_content(body)
        for header, value in (("To", to), ("Subject", subject), ("Cc", cc), ("Bcc", bcc), ("In-Reply-To", in_reply_to), ("References", in_reply_to)):
            if value:
                message[header] = value
        result = {"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()}
        if thread_id:
            result["threadId"] = thread_id
        return result

    def create_draft(self, to, subject, body, **fields):
        message = self._mail_payload(to, subject, body, **fields)
        draft = self._service("gmail", "v1").users().drafts().create(userId="me", body={"message": message}).execute()
        return {"id": draft.get("id"), "message_id": draft.get("message", {}).get("id"), "status": "draft_created"}

    def send_email(self, to, subject, body, **fields):
        message = self._mail_payload(to, subject, body, **fields)
        sent = self._service("gmail", "v1").users().messages().send(userId="me", body=message).execute()
        return {"id": sent.get("id"), "thread_id": sent.get("threadId"), "status": "sent"}

    def execute_tool(self, name, arguments, session_id=None):
        from backend import workspace_jobs

        methods = {
            "gcal_list_events": self.list_calendar_events, "gcal_list_calendars": self.list_calendars,
            "gcal_create_event": self.create_calendar_event, "gcal_update_event": self.update_calendar_event,
            "gcal_delete_event": self.delete_calendar_event, "gtasks_list_tasks": self.list_tasks,
            "gtasks_list_lists": self.list_tasklists, "gtasks_create_task": self.create_task,
            "gtasks_update_task": self.update_task, "gtasks_complete_task": self.complete_task,
            "gmail_list_unread": self.list_unread_emails, "gmail_search": self.list_unread_emails,
            "gmail_get_thread": self.get_thread, "gmail_list_labels": self.list_labels,
            "gmail_create_label": self.create_label, "gmail_modify": self.modify_mail,
            "gmail_create_draft": self.create_draft,
        }
        if name in methods:
            return methods[name](**arguments)
        if name == "workspace_list_jobs":
            return workspace_jobs.list_jobs()
        if name == "workspace_cancel_job":
            return workspace_jobs.cancel_job(arguments["job_id"], self)
        if name == "gmail_snooze":
            thread = self.get_thread(arguments["thread_id"], max_messages=20)
            if not any("INBOX" in message["labels"] for message in thread["messages"]):
                raise ValueError("Snooze requires a thread currently in the inbox.")
            job = workspace_jobs.create_job("gmail_wake", {"thread_id": arguments["thread_id"]}, run_at=arguments["wake_at"], status="preparing", account_email=self._job_account())
            try:
                self.modify_mail(arguments["thread_id"], "thread", "archive")
                return workspace_jobs.activate_job(job["id"])
            except Exception as error:
                workspace_jobs.pause_job(job["id"], f"Snooze setup uncertain: {error}; inspect the thread, then cancel this job to restore INBOX.")
                raise
        raise ValueError(f"Unsupported workspace tool: {name}")

    def approve_email(self, action_id, parameters):
        from backend import workspace_jobs

        fields = dict(parameters)
        account_email = fields.pop("_account_email", None)
        current_account = self._job_account()
        if account_email and account_email != current_account:
            raise ValueError("This approval was prepared for a different Google account. Reconnect that account or create a new approval.")
        send_at = fields.pop("send_at", None)
        self._mail_payload(**fields)
        if send_at:
            return {"status": "scheduled", "job": workspace_jobs.create_job("gmail_send", fields, run_at=send_at, job_id=action_id, account_email=current_account)}
        return self.send_email(**fields)


# Singleton service instance
google_workspace = GoogleWorkspaceService()
