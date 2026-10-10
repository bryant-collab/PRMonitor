import {
  createElement,
  forwardRef,
  useId,
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

const descriptions: Record<string, string> = {
  PRs: "Open tracked pull requests and review work that needs attention.",
  Activity: "Read the history of monitoring, reviews and local work.",
  Settings: "Configure connections, work permissions and monitoring.",
  "Add PR":
    "Add a GitHub pull request by its URL. Existing work stays available.",
  "Check all PRs now": "Request a fresh read of every tracked pull request.",
  "Pause watching":
    "Pause new polling. Saved work and running tasks remain available.",
  "Resume watching": "Resume polling with the saved monitoring interval.",
  "Needs attention":
    "Show pull requests waiting for a decision or a correction.",
  Running: "Show pull requests with work currently in progress.",
  "All PRs": "Show every tracked pull request.",
  "Select all":
    "Select every PR in the inbox, including those hidden by a filter.",
  "Discard changes":
    "Restore this form's saved values. This does not discard any worktree edits.",
  "Save connection":
    "Save this computer's program and launch choices for future AI work.",
  "Browse for program":
    "Choose an installed program if automatic detection missed it.",
  "Check program and sign-in":
    "Check the selected program and local sign-in without starting AI work.",
  "Extra launch options":
    "Add supported options such as --no-daemon. PRMonitor keeps control of workspace and permissions.",
  "Advanced task choices":
    "Override the default connection and model for an individual task.",
  "Compare permission levels":
    "Read what each permission level allows before choosing one.",
};

export function controlHelp(element: HTMLElement, explicit?: string): string {
  if (explicit) return explicit;
  const described = (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .map((id) => {
      const node = element.ownerDocument.getElementById(id);
      return node?.getAttribute("role") === "tooltip"
        ? undefined
        : node?.textContent?.trim();
    })
    .filter(Boolean)
    .join(" ");
  if (described) return described;
  const field = element as HTMLInputElement;
  const labelText = field.labels?.[0]
    ? Array.from(field.labels[0].childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent)
        .join(" ")
    : undefined;
  const label =
    element.getAttribute("aria-label") ??
    labelText ??
    element.textContent ??
    "";
  const text = label.trim().replace(/\s+/gu, " ").slice(0, 240);
  if (descriptions[text]) return descriptions[text];
  if (element.tagName === "SUMMARY")
    return `Expand or collapse ${text.toLowerCase()}.`;
  if (element.tagName === "A") return `Open ${text || "this link"}.`;
  if (element.tagName === "SELECT")
    return `Choose ${text.toLowerCase()}. Save the form to apply your choice.`;
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    if (field.type === "checkbox")
      return `Enable or clear ${text.toLowerCase()}.`;
    return `Enter ${text.toLowerCase()}.${field.placeholder ? ` Example: ${field.placeholder}.` : " Changes are saved with this form."}`;
  }
  return text || "Use this control to continue.";
}

function withHelp<T extends HTMLElement, P extends HTMLAttributes<T>>(
  tag: string,
) {
  return forwardRef<T, P & { readonly help?: string }>(
    function HelpControl(props, ref) {
      const { help, ...rest } = props;
      const native = useRef<T>(null);
      const id = useId();
      const [tip, setTip] = useState<{
        text: string;
        top: number;
        left: number;
      }>();
      const focused = useRef(false);
      const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
      );
      const stopHiding = () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      };
      const hideSoon = () => {
        stopHiding();
        if (!focused.current)
          hideTimer.current = setTimeout(() => setTip(undefined), 150);
      };
      useEffect(() => () => stopHiding(), []);
      const show = () => {
        stopHiding();
        const element = native.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        setTip({
          text: controlHelp(element, help),
          top: Math.min(rect.bottom + 8, window.innerHeight - 96),
          left: Math.min(
            Math.max(8, rect.left),
            Math.max(8, window.innerWidth - 320),
          ),
        });
      };
      const disabled = "disabled" in props && props.disabled === true;
      const control = createElement(tag, {
        ...rest,
        ref: (element: T | null) => {
          native.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        },
        "aria-describedby":
          [props["aria-describedby"], tip ? id : undefined]
            .filter(Boolean)
            .join(" ") || undefined,
        onFocus: (event: React.FocusEvent<T>) => {
          focused.current = true;
          show();
          props.onFocus?.(event);
        },
        onBlur: (event: React.FocusEvent<T>) => {
          focused.current = false;
          setTip(undefined);
          props.onBlur?.(event);
        },
        onMouseEnter: (event: React.MouseEvent<T>) => {
          show();
          props.onMouseEnter?.(event);
        },
        onMouseLeave: (event: React.MouseEvent<T>) => {
          hideSoon();
          props.onMouseLeave?.(event);
        },
        onKeyDown: (event: React.KeyboardEvent<T>) => {
          if (event.key === "Escape") setTip(undefined);
          props.onKeyDown?.(event);
        },
      });
      return (
        <>
          {disabled ? (
            <span
              className="control-help-disabled"
              tabIndex={0}
              onFocus={() => {
                focused.current = true;
                show();
              }}
              onBlur={() => {
                focused.current = false;
                setTip(undefined);
              }}
              onMouseEnter={show}
              onMouseLeave={hideSoon}
              onKeyDown={(event) => {
                if (event.key === "Escape") setTip(undefined);
              }}
              aria-describedby={tip ? id : undefined}
            >
              {control}
            </span>
          ) : (
            control
          )}
          {tip && typeof document !== "undefined"
            ? createPortal(
                <span
                  id={id}
                  className="control-tooltip"
                  role="tooltip"
                  onMouseEnter={stopHiding}
                  onMouseLeave={hideSoon}
                  style={{ top: tip.top, left: tip.left }}
                >
                  {tip.text}
                </span>,
                document.body,
              )
            : null}
        </>
      );
    },
  );
}

export const HelpButton = withHelp<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>("button");
export const HelpInput = withHelp<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>("input");
export const HelpSelect = withHelp<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>("select");
export const HelpTextarea = withHelp<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>("textarea");
// A summary must remain the direct first child of details.
export const HelpSummary = withHelp<HTMLElement, HTMLAttributes<HTMLElement>>(
  "summary",
);
export const HelpAnchor = withHelp<
  HTMLAnchorElement,
  AnchorHTMLAttributes<HTMLAnchorElement>
>("a");
