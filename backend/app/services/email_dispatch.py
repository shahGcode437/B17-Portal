"""How a message leaves a request (EMAIL-1; docs/backend/AUTH_RBAC.md §14.2).

Services return messages; a router hands them to the dispatcher **after** the service committed.

Why not FastAPI ``BackgroundTasks``: they run while the request's database session is still open
(building the response reads from it again, so the pooled connection sat *idle in transaction* for
as long as the send took) and on the same thread pool that serves requests. Harmless when "sending"
meant printing; not with a provider that can take seconds.

:class:`BackgroundEmailDispatcher` is a small **bounded** hand-off: a fixed number of worker
threads that never touch the database, a cap on queued messages (a full queue drops the message and
says so in the log), and a time-limited drain at shutdown.

**It is not durable.** The queue lives in the API process: a crash, or a shutdown that outlasts the
drain, loses what was not yet sent. Verification and reset mail can be requested again by the user;
a lost security notice is not re-sent. A durable outbox would need a table, a migration and a worker
process - deliberately not built without the owner's approval.
"""

import contextvars
import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor, wait
from typing import Protocol

from app.services.email import EmailMessage, EmailSender, deliver

logger = logging.getLogger("app.email")

WORKERS = 2
MAX_PENDING = 100
DRAIN_SECONDS = 15.0


class EmailDispatcher(Protocol):
    def submit(self, sender: EmailSender, message: EmailMessage) -> None:
        """Hand one message over. Never raises."""
        ...

    def close(self) -> None: ...


class InlineEmailDispatcher:
    """Sends immediately in the caller's thread. Used only with the ``memory`` backend (tests),
    where "sending" is appending to a list."""

    def submit(self, sender: EmailSender, message: EmailMessage) -> None:
        deliver(sender, message)

    def close(self) -> None:
        return None


class BackgroundEmailDispatcher:
    def __init__(
        self,
        *,
        workers: int = WORKERS,
        max_pending: int = MAX_PENDING,
        drain_seconds: float = DRAIN_SECONDS,
    ) -> None:
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="b17-email")
        self._slots = threading.BoundedSemaphore(max_pending)
        self._drain_seconds = drain_seconds
        self._pending: set[Future[None]] = set()
        self._lock = threading.Lock()
        self._closed = False

    def submit(self, sender: EmailSender, message: EmailMessage) -> None:
        if self._closed:
            self._dropped(message, "shutting_down")
            return
        if not self._slots.acquire(blocking=False):  # never make a request wait for mail
            self._dropped(message, "queue_full")
            return
        context = contextvars.copy_context()  # the log keeps the request id of its cause
        try:
            future = self._executor.submit(context.run, deliver, sender, message)
        except RuntimeError:  # the executor was shut down between the check and here
            self._slots.release()
            self._dropped(message, "shutting_down")
            return
        with self._lock:
            self._pending.add(future)
        future.add_done_callback(self._finished)

    def _finished(self, future: "Future[None]") -> None:
        with self._lock:
            self._pending.discard(future)
        self._slots.release()

    @staticmethod
    def _dropped(message: EmailMessage, reason: str) -> None:
        logger.error("email not queued", extra={"emailKind": message.kind, "reason": reason})

    def drain(self, timeout: float) -> bool:
        """Wait for what is queued now; ``True`` when all of it finished in time."""
        with self._lock:
            pending = set(self._pending)
        _, unfinished = wait(pending, timeout=timeout)
        return not unfinished

    def close(self) -> None:
        self._closed = True
        if not self.drain(self._drain_seconds):
            with self._lock:
                unfinished = len(self._pending)
            logger.error("email unfinished at shutdown", extra={"count": unfinished})
        # Cancels what never started; a send already running ends within its own timeouts.
        self._executor.shutdown(wait=False, cancel_futures=True)
