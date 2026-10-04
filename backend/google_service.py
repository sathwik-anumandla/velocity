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

    def list_calendar_events(
        self,
        time_min: Optional[str] = None,
        time_max: Optional[str] = None,
        max_results: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Lists upcoming calendar events from the user's primary calendar.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Calendar is not connected. Connect via Settings -> Plugins.")

        service = build("calendar", "v3", credentials=creds)

        if not time_min:
            time_min = datetime.now(timezone.utc).isoformat()
        if not time_max:
            # Default to end of next day (48h ahead)
            time_max = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()

        events_result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )

        items = events_result.get("items", [])
        events = []
        for it in items:
            start = it.get("start", {}).get("dateTime") or it.get("start", {}).get("date")
            end = it.get("end", {}).get("dateTime") or it.get("end", {}).get("date")
            meet_link = None
            if it.get("conferenceData") and it["conferenceData"].get("entryPoints"):
                for ep in it["conferenceData"]["entryPoints"]:
                    if ep.get("entryPointType") == "video":
                        meet_link = ep.get("uri")
                        break

            attendees = [a.get("email") for a in it.get("attendees", []) if a.get("email")]

            events.append({
                "id": it.get("id"),
                "summary": it.get("summary", "(No title)"),
                "description": it.get("description", ""),
                "start": start,
                "end": end,
                "meet_link": meet_link,
                "html_link": it.get("htmlLink"),
                "attendees": attendees,
                "status": it.get("status"),
            })
        return events

    def create_calendar_event(
        self,
        summary: str,
        start_time: str,
        end_time: str,
        description: Optional[str] = None,
        attendees: Optional[List[str]] = None,
        add_meet: bool = True,
    ) -> Dict[str, Any]:
        """
        Creates a new event on the primary calendar with optional Google Meet.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Calendar is not connected. Connect via Settings -> Plugins.")

        service = build("calendar", "v3", credentials=creds)

        body: Dict[str, Any] = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": start_time} if "T" in start_time else {"date": start_time},
            "end": {"dateTime": end_time} if "T" in end_time else {"date": end_time},
        }

        if attendees:
            body["attendees"] = [{"email": a} for a in attendees]

        conference_data_version = 0
        if add_meet:
            conference_data_version = 1
            body["conferenceData"] = {
                "createRequest": {
                    "requestId": f"meet_{int(datetime.now().timestamp())}",
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            }

        created = (
            service.events()
            .insert(
                calendarId="primary",
                body=body,
                conferenceDataVersion=conference_data_version,
            )
            .execute()
        )

        meet_link = None
        if created.get("conferenceData") and created["conferenceData"].get("entryPoints"):
            for ep in created["conferenceData"]["entryPoints"]:
                if ep.get("entryPointType") == "video":
                    meet_link = ep.get("uri")
                    break

        return {
            "id": created.get("id"),
            "summary": created.get("summary"),
            "start": created.get("start", {}).get("dateTime") or created.get("start", {}).get("date"),
            "end": created.get("end", {}).get("dateTime") or created.get("end", {}).get("date"),
            "meet_link": meet_link,
            "html_link": created.get("htmlLink"),
            "status": "created",
        }

    def delete_calendar_event(self, event_id: str) -> Dict[str, Any]:
        """
        Deletes a calendar event by ID.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Calendar is not connected. Connect via Settings -> Plugins.")

        service = build("calendar", "v3", credentials=creds)
        service.events().delete(calendarId="primary", eventId=event_id).execute()
        return {"id": event_id, "status": "deleted"}

    # ==========================================================================
    # Google Tasks Operations
    # ==========================================================================

    def list_tasks(
        self,
        include_completed: bool = False,
        due_max: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Lists tasks from the default task list.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Tasks is not connected. Connect via Settings -> Plugins.")

        service = build("tasks", "v1", credentials=creds)

        req_kwargs: Dict[str, Any] = {
            "tasklist": "@default",
            "showCompleted": include_completed,
            "showHidden": include_completed,
        }
        if due_max:
            req_kwargs["dueMax"] = due_max

        result = service.tasks().list(**req_kwargs).execute()
        items = result.get("items", [])

        tasks = []
        for it in items:
            tasks.append({
                "id": it.get("id"),
                "title": it.get("title", "(No title)"),
                "notes": it.get("notes", ""),
                "status": it.get("status"),
                "due": it.get("due"),
                "updated": it.get("updated"),
            })
        return tasks

    def create_task(
        self,
        title: str,
        notes: Optional[str] = None,
        due: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Creates a new task in Google Tasks.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Tasks is not connected. Connect via Settings -> Plugins.")

        service = build("tasks", "v1", credentials=creds)

        body: Dict[str, Any] = {"title": title}
        if notes:
            body["notes"] = notes
        if due:
            # Google Tasks due date requires RFC 3339 format, e.g. 2026-10-05T00:00:00.000Z
            if "T" not in due:
                due = f"{due}T00:00:00.000Z"
            body["due"] = due

        created = service.tasks().insert(tasklist="@default", body=body).execute()
        return {
            "id": created.get("id"),
            "title": created.get("title"),
            "notes": created.get("notes", ""),
            "due": created.get("due"),
            "status": created.get("status", "needsAction"),
        }

    def complete_task(self, task_id: str) -> Dict[str, Any]:
        """
        Marks a task as completed.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Google Tasks is not connected. Connect via Settings -> Plugins.")

        service = build("tasks", "v1", credentials=creds)
        updated = service.tasks().patch(
            tasklist="@default",
            task=task_id,
            body={"status": "completed"},
        ).execute()

        return {
            "id": updated.get("id"),
            "title": updated.get("title"),
            "status": "completed",
        }

    # ==========================================================================
    # Gmail Operations
    # ==========================================================================

    def list_unread_emails(
        self,
        query: str = "is:unread category:primary",
        max_results: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Retrieves unread priority messages with header summaries.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Gmail is not connected. Connect via Settings -> Plugins.")

        service = build("gmail", "v1", credentials=creds)
        res = service.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
        messages_meta = res.get("messages", [])

        emails = []
        for m in messages_meta:
            msg_id = m.get("id")
            msg = service.users().messages().get(
                userId="me",
                id=msg_id,
                format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()

            headers = {h.get("name", "").lower(): h.get("value", "") for h in msg.get("payload", {}).get("headers", [])}
            emails.append({
                "id": msg_id,
                "thread_id": msg.get("threadId"),
                "from": headers.get("from", "Unknown"),
                "subject": headers.get("subject", "(No Subject)"),
                "date": headers.get("date", ""),
                "snippet": msg.get("snippet", ""),
            })
        return emails

    def create_draft(self, to: str, subject: str, body: str) -> Dict[str, Any]:
        """
        Creates an email draft in Gmail without sending it.
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Gmail is not connected. Connect via Settings -> Plugins.")

        service = build("gmail", "v1", credentials=creds)

        message = EmailMessage()
        message.set_content(body)
        message["To"] = to
        message["Subject"] = subject

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        draft = service.users().drafts().create(
            userId="me",
            body={"message": {"raw": encoded_message}},
        ).execute()

        return {
            "id": draft.get("id"),
            "message_id": draft.get("message", {}).get("id"),
            "to": to,
            "subject": subject,
            "status": "draft_created",
        }

    def send_email(self, to: str, subject: str, body: str) -> Dict[str, Any]:
        """
        Directly sends an email via Gmail API (requires explicit user confirmation).
        """
        creds = self.get_credentials()
        if not creds:
            raise RuntimeError("Gmail is not connected. Connect via Settings -> Plugins.")

        service = build("gmail", "v1", credentials=creds)

        message = EmailMessage()
        message.set_content(body)
        message["To"] = to
        message["Subject"] = subject

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        sent = service.users().messages().send(
            userId="me",
            body={"raw": encoded_message},
        ).execute()

        return {
            "id": sent.get("id"),
            "thread_id": sent.get("threadId"),
            "to": to,
            "subject": subject,
            "status": "sent",
        }


# Singleton service instance
google_workspace = GoogleWorkspaceService()
