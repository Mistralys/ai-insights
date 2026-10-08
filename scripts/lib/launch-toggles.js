/**
 * scripts/lib/launch-toggles.js
 *
 * Registry and state model for the `ai-insights agent` picker's session-scoped
 * toggles. A toggle is a pinned picker row that flips a `claude` CLI flag on or
 * off for every launch made from the picker. Deliberately has no `main()` —
 * matching the scripts/lib/*.js shape.
 *
 * Growth path: a new toggle (e.g. `--verbose` to diagnose MCP failures) is one
 * more object in {@link LAUNCH_TOGGLES}. Rendering, seeding from CLI args, and
 * argv emission are already driven by the registry.
 *
 * {@link LaunchToggles} is the single owner of toggle state for one picker run:
 * created once by scripts/launch-agent.js and mutated in place by the pickers.
 * State is never persisted — every `ai-insights agent` invocation starts off.
 */

/**
 * @typedef {object} ToggleDefinition
 * @property {string} id - Stable identifier (also used in the launch-entry id)
 * @property {string} label - Row label shown in the picker
 * @property {string} description - Filterable description
 * @property {string} claudeFlag - Flag appended to the `claude` argv while on
 * @property {string} seedFlag - Own-flag of `ai-insights agent` that seeds the toggle on
 * @property {boolean} warning - Show a persistent warning while on
 */

/** @type {ReadonlyArray<Readonly<ToggleDefinition>>} */
export const LAUNCH_TOGGLES = Object.freeze([
  Object.freeze({
    id: 'skip-permissions',
    label: 'Skip permission prompts',
    description:
      'Launch every session from this picker with --dangerously-skip-permissions (applies until toggled off)',
    claudeFlag: '--dangerously-skip-permissions',
    seedFlag: '--skip-permissions',
    warning: true,
  }),
]);

export class LaunchToggles {
  /**
   * @param {ReadonlyArray<ToggleDefinition>} [defs]
   * @param {string[]} [enabledIds] - Toggle ids that start enabled
   * @throws {Error} When an enabled id is not in `defs`
   */
  constructor(defs = LAUNCH_TOGGLES, enabledIds = []) {
    this._defs = defs;
    this._enabled = new Set();
    for (const id of enabledIds) {
      this._requireDef(id);
      this._enabled.add(id);
    }
  }

  /** @returns {ReadonlyArray<ToggleDefinition>} */
  get definitions() {
    return this._defs;
  }

  /** @param {string} id */
  _requireDef(id) {
    const def = this._defs.find((d) => d.id === id);
    if (!def) {
      throw new Error(`Unknown launch toggle: "${id}"`);
    }
    return def;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  isOn(id) {
    return this._enabled.has(id);
  }

  /**
   * Flips a toggle in place.
   *
   * @param {string} id
   * @returns {boolean} The new state
   * @throws {Error} On an unknown id
   */
  toggle(id) {
    this._requireDef(id);
    if (this._enabled.has(id)) {
      this._enabled.delete(id);
      return false;
    }
    this._enabled.add(id);
    return true;
  }

  /**
   * Flags of every enabled toggle, in registry order.
   *
   * @returns {string[]}
   */
  toClaudeArgs() {
    return this._defs.filter((d) => this._enabled.has(d.id)).map((d) => d.claudeFlag);
  }

  /**
   * Labels of enabled toggles that request a persistent warning.
   *
   * @returns {string[]}
   */
  activeWarnings() {
    return this._defs.filter((d) => d.warning && this._enabled.has(d.id)).map((d) => d.label);
  }

  /**
   * Builds toggle state from CLI args. A toggle is seeded on when its
   * `seedFlag` appears in `ownArgs` or its `claudeFlag` appears in
   * `passthroughArgs`. Seeded `claudeFlag`s are stripped from the returned
   * passthrough list so the flag is emitted exactly once and stays switchable.
   * Inputs are never mutated.
   *
   * @param {string[]} ownArgs
   * @param {string[]} passthroughArgs
   * @param {ReadonlyArray<ToggleDefinition>} [defs]
   * @returns {{toggles: LaunchToggles, passthroughArgs: string[]}}
   */
  static fromArgs(ownArgs, passthroughArgs, defs = LAUNCH_TOGGLES) {
    const own = ownArgs || [];
    const pass = passthroughArgs || [];
    const seeded = defs.filter((d) => own.includes(d.seedFlag) || pass.includes(d.claudeFlag));
    const absorbed = new Set(seeded.map((d) => d.claudeFlag));
    return {
      toggles: new LaunchToggles(
        defs,
        seeded.map((d) => d.id),
      ),
      passthroughArgs: pass.filter((arg) => !absorbed.has(arg)),
    };
  }
}
