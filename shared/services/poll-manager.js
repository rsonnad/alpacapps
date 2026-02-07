/**
 * Poll Manager - Reusable polling with visibility-based pause
 * Used by all mobile tab modules to refresh data on an interval,
 * pausing when the app/tab is not visible.
 */

export class PollManager {
  /**
   * @param {Function} callback - Async function to call on each poll
   * @param {number} intervalMs - Polling interval in milliseconds (default 30000)
   */
  constructor(callback, intervalMs = 30000) {
    this._callback = callback;
    this._intervalMs = intervalMs;
    this._timer = null;
    this._onVisChange = this._handleVisibility.bind(this);
  }

  start() {
    this.stop();
    this._callback(); // immediate first poll
    this._timer = setInterval(() => this._callback(), this._intervalMs);
    document.addEventListener('visibilitychange', this._onVisChange);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    document.removeEventListener('visibilitychange', this._onVisChange);
  }

  /** Force an immediate poll (resets the interval). */
  refresh() {
    this.stop();
    this.start();
  }

  _handleVisibility() {
    if (document.hidden) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    } else {
      this._callback();
      this._timer = setInterval(() => this._callback(), this._intervalMs);
    }
  }
}
