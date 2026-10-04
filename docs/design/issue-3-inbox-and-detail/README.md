# Approved PRMonitor layout: Inbox and detail

Approved by the product owner on October 4, 2026.

Implementation brief: [Issue #3](https://github.com/bryant-collab/PRMonitor/issues/3).
Related requirements: [mandatory setup, Issue #1](https://github.com/bryant-collab/PRMonitor/issues/1)
and [Activity and clear customer language, Issue #2](https://github.com/bryant-collab/PRMonitor/issues/2).

## Files

- [inbox-and-detail.html](inbox-and-detail.html): self-contained interactive browser preview of the chosen layout. Download the raw file and open it locally in a browser. GitHub's file view displays the HTML source.
- [inbox-and-detail-source.html](inbox-and-detail-source.html): small, readable HTML/CSS/JavaScript source fragment for implementation agents to inspect. Use the complete standalone file for the browser preview.
- [design-specification.md](design-specification.md): snapshot of the approved implementation brief at reference publication time. The current issue body is authoritative for subsequent corrections.

No original local clone, ChatGPT rendering support, login, live API, or service credentials are needed to open the preview. The standalone wrapper includes the preview's styles and runtime.

## Approved design direction

Persistent navigation, a compact inbox beside selected-PR detail, focused settings and Activity destinations, a dedicated full review/result workspace, and a clear connection/interrupted-work destination. Setup remains visible until mandatory readiness is complete under Issue #1.

Keep all existing workflows, operation guards, confirmations and evidence. The preservation matrix, language rules, routing behavior, responsive behavior and acceptance tests in Issue #3 fill in details that the small prototype cannot show.

## Prototype limitations

The PRs and configuration are fictional examples. The buttons simulate navigation or show explanatory feedback; they do not execute Git, GitHub, AI work or configuration changes. The preview illustrates information hierarchy and visual direction. Simplified editors, sample counts, incidental placeholder wording and omitted advanced controls are not authority to remove functionality or invent new business behavior.

Apply Issue #2's ASD-STE100-inspired language requirements in the production UI. Never copy internal feature IDs, state-machine names or implementation explanations into customer messages. Raw support evidence is separate from customer explanations.

Do not copy the prototype into runtime code or seed customer state from it. Build the approved shell using the existing React, typed IPC, main-process services and persisted contracts.

The reference is stored on a dedicated design branch; no application behavior is changed by this reference commit. Issue #3 links an immutable commit so implementing agents can fetch these files even if their checkout starts on the default branch.
