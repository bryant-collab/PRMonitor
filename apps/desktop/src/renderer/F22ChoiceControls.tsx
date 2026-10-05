import { useEffect, useRef } from "react";
import type { F22DirtyWorktreeChoice } from "../shared/f22-discard-reevaluation";

export interface F22ChoiceControlsProps {
  readonly requiredChoice: F22DirtyWorktreeChoice;
  readonly choice: F22DirtyWorktreeChoice;
  readonly confirmed: boolean;
  readonly busy: boolean;
  readonly onChoiceChange: (choice: F22DirtyWorktreeChoice) => void;
  readonly onConfirmedChange: (confirmed: boolean) => void;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function f22ChoiceConfirmDisabled(input: {
  readonly choice: F22DirtyWorktreeChoice;
  readonly confirmed: boolean;
  readonly busy: boolean;
}): boolean {
  return input.busy || (input.choice !== "KEEP_AND_CANCEL" && !input.confirmed);
}

export function F22ChoiceControls({
  requiredChoice,
  choice,
  confirmed,
  busy,
  onChoiceChange,
  onConfirmedChange,
  onConfirm,
  onClose,
}: F22ChoiceControlsProps) {
  const focusTarget = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    focusTarget.current?.focus();
  }, []);
  return (
    <div
      className="review-f22-controls"
      role="group"
      aria-labelledby="f22-choice-heading"
    >
      <h4
        id="f22-choice-heading"
        ref={focusTarget}
        tabIndex={-1}
        data-f22-focus-target="true"
      >
        Worktree choice
      </h4>
      <p id="f22-choice-help" className="review-evidence-note">
        Choose one bounded worktree outcome. Keyboard focus moves here when the
        action preview opens.
      </p>
      <label htmlFor="f22-worktree-choice">Worktree choice</label>
      <select
        id="f22-worktree-choice"
        aria-describedby="f22-choice-help"
        value={choice}
        onChange={(event) => {
          onChoiceChange(event.target.value as F22DirtyWorktreeChoice);
          onConfirmedChange(false);
        }}
      >
        {requiredChoice === "NO_CHANGES" ? (
          <option value="NO_CHANGES">No Changes (clean worktree)</option>
        ) : null}
        {requiredChoice !== "NO_CHANGES" ? (
          <>
            <option value="CLEAR_ALL">Clear All Changes</option>
            <option value="CLEAR_AI_ONLY">Clear Only AI Changes</option>
          </>
        ) : null}
        <option value="KEEP_AND_CANCEL">Keep Worktree and Cancel</option>
      </select>
      {choice !== "KEEP_AND_CANCEL" ? (
        <label className="review-checkbox" htmlFor="f22-confirmation">
          <input
            id="f22-confirmation"
            type="checkbox"
            checked={confirmed}
            aria-describedby="f22-choice-help"
            onChange={(event) => onConfirmedChange(event.target.checked)}
          />
          {choice === "CLEAR_ALL"
            ? "I understand Clear All Changes is destructive."
            : "I explicitly confirm this action choice and its recorded worktree outcome."}
        </label>
      ) : null}
      <div className="review-f22-actions">
        <button
          id="f22-confirm-choice"
          type="button"
          disabled={f22ChoiceConfirmDisabled({ choice, confirmed, busy })}
          onClick={onConfirm}
        >
          Confirm action choice
        </button>
        <button
          id="f22-close-preview"
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onClose}
        >
          Close preview
        </button>
      </div>
    </div>
  );
}
