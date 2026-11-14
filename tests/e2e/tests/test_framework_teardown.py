"""
Self-test for the e2e teardown drain (forge-ldyn): a test window that ignores
close must not leave the session dirty for every later test, and must still
fail the test that left it.
"""

import os
import signal

import conftest
import pytest


def test_teardown_kills_stuck_window(shell_proxy, launch_window):
    window = launch_window()
    # A stopped client never answers delete(), like a hung app.
    os.kill(window["pid"], signal.SIGSTOP)

    with pytest.raises(RuntimeError, match="killed test windows"):
        conftest._close_all_windows(shell_proxy)

    assert not conftest._launched_procs
    # The kill reaped the process, so its pid is gone.
    with pytest.raises(ProcessLookupError):
        os.kill(window["pid"], 0)
    assert shell_proxy.get_total_window_count() == 0
