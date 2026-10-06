// State contract of the dotfiles-mod plugin. Self-contained: no imports.

/** A file this session edited through Edit/Write/NotebookEdit. */
export type EditEntry = {
  path: string
  /** Where `path` lives inside ~/dotfiles (itself, or its symlink target); git status runs on this. */
  gitPath: string
  /** Under ~/dotfiles outside docs/.claude/tests/.github: live the moment it is saved. */
  isLive: boolean
}

/**
 * `git status --porcelain` code for an edited file, keyed by `gitPath`:"M", "A", "??", ...;
 * "ok" when committed (no status line), "-" when outside a git repository.
 */
export type EditStatus = Record<string, string>

/** A PR this session opened and its code-reviewer state (a wording guess, display only). */
export type PrReview = {
  url: string
  number: number
  /** none: not reviewed; running: launched/resumed; blocking: crit/high seen; clear: none seen. */
  review: 'none' | 'running' | 'blocking' | 'clear'
  /** The reviewer's agent id for a SendMessage re-review, or "". */
  reviewer: string
}

declare module 'claude-code' {
  interface PluginState {
    'dotfiles-mod': {
      edits: EditEntry[]
      status: EditStatus
      prs: PrReview[]
    }
  }
}
