"""
The fuzzer's frame rule (ShellProxy.fuzz_frame_mismatch) against a real shell.

The rule compares each tiled window's Mutter frame with the slot Forge laid out.
These tests show it reads real frames: a settled layout passes, and a slot the
frame is not at is reported.
"""

from framework import wait_for
from framework.constants import FORGE_UUID


def _probe_when_idle(read):
    """Read the frame probe until Forge has no work pending (a busy read reports nothing)."""
    return wait_for(read, message="Forge stayed busy", predicate=lambda r: not r.get("busy"))


class TestFrameOracle:
    def test_settled_layout_has_every_frame_at_its_slot(self, shell_proxy, two_windows):
        shell_proxy.wait_for_layout_landed()
        assert _probe_when_idle(shell_proxy.fuzz_frame_mismatch) == {
            "violations": [],
            "busy": False,
        }

    def test_reports_a_window_whose_frame_is_not_at_its_slot(self, shell_proxy, two_windows):
        shell_proxy.wait_for_layout_landed()

        # Put one window's slot 50px right of its frame and probe in the same eval, so no
        # render can lay the slot out again in between
        def shift_and_probe():
            return shell_proxy.eval(
                """
                (() => {
                  const wm = Main.extensionManager.lookup('%s').stateObj.extWm;
                  const node = wm.tree.getNodeByType('WINDOW').find((n) => n.isTile());
                  const f = node.nodeValue.get_frame_rect();
                  node.renderRect = { x: f.x + 50, y: f.y, width: f.width, height: f.height };
                  const probe = JSON.parse(globalThis._forgeTestBridge.fuzzFrameMismatch());
                  return JSON.stringify({ ...probe, id: node.nodeValue.get_id() });
                })()
                """
                % FORGE_UUID
            )

        try:
            res = _probe_when_idle(shift_and_probe)
            violations = res["violations"]
            assert [v["rule"] for v in violations] == ["frame-off-slot"], violations
            assert "window %d " % res["id"] in violations[0]["detail"], violations
        finally:
            shell_proxy.fuzz_render_now()
        shell_proxy.wait_for_layout_landed()
        assert _probe_when_idle(shell_proxy.fuzz_frame_mismatch) == {
            "violations": [],
            "busy": False,
        }
