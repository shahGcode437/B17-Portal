"""B-17 Portal backend API."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("b17-portal-api")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0"
