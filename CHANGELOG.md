# Changes

## 2026-10-23 — Preserve selected audio outputs when toggling monitors

Monitor off/on operations could leave Windows playback on a different output. The plugin now captures Console, Multimedia and Communications playback selections independently before the display topology change, then restores changed roles only while their original outputs remain active. This applies to off, on and restore; overlapping plugin toggles are queued.

Recovery observes defaults for 2–3 seconds and makes one restoration pass. It preserves the user's choices without enforcing a fixed DAC. Both DACs remain usable, and monitors are technically disabled from the desktop topology.

Validation: 16 audio regression scenarios, a queue test, read-only backend/Node checks and JSON/syntax/whitespace checks passed. In the physical second-monitor off/on test, playback briefly switched to Moonriver 2 and returned to iFi in about two seconds on both operations; communications stayed on Moonriver 2.

Known limits: a brief interruption/reroute remains possible; a manual audio selection during recovery may be restored. The native setter uses undocumented Windows PolicyConfig and reports failures without blocking display changes. The exact reason Windows selected Moonriver is unresolved. NVIDIA monitor playback endpoints were found disabled; an earlier separate diagnostic logger's masked registry states had incorrectly suggested they were active.

See [audio behavior, validation, diagnostic correction and rollback](docs/AUDIO_PRESERVATION.md).
