# Approved reference snapshot

`approved-reference.html` is the immutable issue-3 browser preview from design
commit `f76e39453121e40eb3c8ead9dcd52c3c102c6b23`. Its SHA-256 is
`f7b3c0cd8ba6d0eed0c9ebe414187285daa7268dafc9dc7ee78f6afc6d4503a0`.
Do not format or modify the snapshot. The acceptance loader verifies these exact
bytes, so it works in shallow CI checkouts without fetching design history.

This is a test reference with fictional prototype data, never runtime source or
customer state. The package guard rejects this filename anywhere in a runtime
payload. It currently paints blank in the isolated Electron reference window;
that capture is a failed reference rendering, not an approved visual comparison.
