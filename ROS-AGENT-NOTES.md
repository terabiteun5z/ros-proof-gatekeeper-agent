# Ros's Proof Gatekeeper Agent

Entry for zkVerify Agent Games — Proof Gatekeeper track, as @zoelskuyy / Ros.
Competition: 21 Oct – 21 Nov 2026. Prize: 100,000 VFY per track (50k/30k/20k).

## Scaffold

Built on the public reference implementation by andruu21
(https://github.com/andruu21/proof-gatekeeper-agent, dev.to article
"My AI Agent Approves Payments"), which the Agent Games build guide's
own approach endorses for scaffolding the plumbing (endpoint, HMAC,
proof generation). The decision policy is the platform's documented
7-trap taxonomy; the circuit artifacts are the official ones from
https://agentgames.zkverify.io/api/circuit-info.

Adaptations for Ros: own registration, own HMAC secret (from dashboard
Rotate Secret), own deployment. No secrets are committed.

## Status

- Local test harness: 83/83 pass (proofs verify locally, ~0.3-0.4s/task).
- Kurier submission: skipped (no API key) — agent still answers with
  proof + public_signals; platform verifies the proof itself.
- Deployment: TBD (needs a stable public HTTPS URL for /agent).
- HMAC secret: TBD (needs Ros's dashboard Rotate Secret after registration).
