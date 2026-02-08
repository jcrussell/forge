"""
Screenshot Capture for E2E tests.

Captures screenshots on test failure for debugging purposes.
"""

import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Optional


class ScreenshotError(Exception):
    """Exception raised when screenshot capture fails."""

    pass


class ScreenshotCapture:
    """
    Captures screenshots of the GNOME Shell session.

    Uses gnome-screenshot or ImageMagick import for capture.
    Screenshots are saved with timestamps for easy identification.
    """

    def __init__(
        self,
        output_dir: str = "e2e-results/screenshots",
        display: Optional[str] = None,
    ):
        """
        Initialize screenshot capture.

        Args:
            output_dir: Directory to save screenshots.
            display: X11 DISPLAY value. If None, uses environment.
        """
        self._output_dir = Path(output_dir)
        self._display = display
        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        """Create output directory if it doesn't exist."""
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def _get_env(self) -> dict:
        """Get environment with DISPLAY set if specified."""
        env = os.environ.copy()
        if self._display:
            env["DISPLAY"] = self._display
        return env

    def _generate_filename(self, prefix: str = "screenshot") -> Path:
        """
        Generate a unique filename for a screenshot.

        Args:
            prefix: Prefix for the filename.

        Returns:
            Path to the screenshot file.
        """
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        return self._output_dir / f"{prefix}_{timestamp}.png"

    def capture(self, filename: Optional[str] = None, delay: float = 0.5) -> Path:
        """
        Capture a screenshot.

        Tries gnome-screenshot first, falls back to ImageMagick import.

        Args:
            filename: Optional specific filename. If None, generates one.
            delay: Delay before capture in seconds.

        Returns:
            Path to the saved screenshot.

        Raises:
            ScreenshotError: If capture fails.
        """
        if delay > 0:
            time.sleep(delay)

        output_path = (
            self._output_dir / filename if filename else self._generate_filename()
        )

        # Try gnome-screenshot first (works well in GNOME Shell)
        try:
            return self._capture_gnome_screenshot(output_path)
        except ScreenshotError:
            pass

        # Fall back to ImageMagick import (X11 only)
        try:
            return self._capture_imagemagick(output_path)
        except ScreenshotError:
            pass

        # Last resort: scrot
        try:
            return self._capture_scrot(output_path)
        except ScreenshotError as e:
            raise ScreenshotError(
                "All screenshot methods failed. "
                "Ensure gnome-screenshot, ImageMagick, or scrot is installed."
            ) from e

    def _capture_gnome_screenshot(self, output_path: Path) -> Path:
        """Capture using gnome-screenshot."""
        try:
            subprocess.run(
                ["gnome-screenshot", "-f", str(output_path)],
                capture_output=True,
                check=True,
                env=self._get_env(),
            )
            if output_path.exists():
                return output_path
            raise ScreenshotError("gnome-screenshot did not create file")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise ScreenshotError(f"gnome-screenshot failed: {e}") from e

    def _capture_imagemagick(self, output_path: Path) -> Path:
        """Capture using ImageMagick import."""
        try:
            subprocess.run(
                ["import", "-window", "root", str(output_path)],
                capture_output=True,
                check=True,
                env=self._get_env(),
            )
            if output_path.exists():
                return output_path
            raise ScreenshotError("ImageMagick import did not create file")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise ScreenshotError(f"ImageMagick import failed: {e}") from e

    def _capture_scrot(self, output_path: Path) -> Path:
        """Capture using scrot."""
        try:
            subprocess.run(
                ["scrot", str(output_path)],
                capture_output=True,
                check=True,
                env=self._get_env(),
            )
            if output_path.exists():
                return output_path
            raise ScreenshotError("scrot did not create file")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise ScreenshotError(f"scrot failed: {e}") from e

    def capture_on_failure(
        self, test_name: str, exception: Optional[Exception] = None
    ) -> Optional[Path]:
        """
        Capture a screenshot on test failure.

        Args:
            test_name: Name of the failing test.
            exception: The exception that caused the failure.

        Returns:
            Path to the saved screenshot, or None if capture fails.
        """
        # Sanitize test name for filename
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in test_name)

        try:
            path = self.capture(filename=f"failure_{safe_name}.png")
            print(f"Screenshot saved: {path}")
            return path
        except ScreenshotError as e:
            print(f"Failed to capture screenshot: {e}")
            return None

    def capture_window(self, window_id: str, filename: Optional[str] = None) -> Path:
        """
        Capture a specific window.

        Args:
            window_id: X11 window ID.
            filename: Optional specific filename.

        Returns:
            Path to the saved screenshot.

        Raises:
            ScreenshotError: If capture fails.
        """
        output_path = (
            self._output_dir / filename
            if filename
            else self._generate_filename("window")
        )

        try:
            subprocess.run(
                ["import", "-window", window_id, str(output_path)],
                capture_output=True,
                check=True,
                env=self._get_env(),
            )
            if output_path.exists():
                return output_path
            raise ScreenshotError("Window capture did not create file")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            raise ScreenshotError(f"Window capture failed: {e}") from e

    def cleanup_old(self, max_age_hours: int = 24) -> int:
        """
        Remove screenshots older than max_age_hours.

        Args:
            max_age_hours: Maximum age in hours before deletion.

        Returns:
            Number of files deleted.
        """
        cutoff = time.time() - (max_age_hours * 3600)
        deleted = 0

        for file in self._output_dir.glob("*.png"):
            if file.stat().st_mtime < cutoff:
                file.unlink()
                deleted += 1

        return deleted

    @property
    def output_dir(self) -> Path:
        """Get the screenshot output directory."""
        return self._output_dir
