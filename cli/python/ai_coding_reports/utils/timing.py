"""Lightweight phase timing for CLI diagnostics."""

from __future__ import annotations

import sys
from contextlib import contextmanager
from time import perf_counter


class TimingLog:
    """Collect named phase durations; emit human-readable summary to stderr."""

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled
        self.entries: list[tuple[str, float]] = []

    @contextmanager
    def span(self, name: str):
        if not self.enabled:
            yield
            return
        t0 = perf_counter()
        try:
            yield
        finally:
            self.entries.append((name, perf_counter() - t0))

    def add(self, name: str, seconds: float) -> None:
        if self.enabled:
            self.entries.append((name, seconds))

    def emit(self, *, header: str = "Timing") -> None:
        if not self.enabled or not self.entries:
            return
        total = sum(d for _, d in self.entries)
        print(f"[{header}]", file=sys.stderr)
        for name, dt in self.entries:
            pct = (dt / total * 100) if total else 0.0
            print(f"  {name:<36} {dt:7.3f}s  ({pct:5.1f}%)", file=sys.stderr)
        print(f"  {'total':<36} {total:7.3f}s", file=sys.stderr)
