# Coding Interview mode — analysis, decisions, and the plan

**Status:** analysis complete; foundation built; two decisions await a human.
**Date:** 2026-08-24

This is the deliverable the brief asked for before any building: the engine
decision, the legal decision, the data model, and — the part that turned out to
matter most — the exact inventory of what an eighth interview mode touches across
four languages.

Everything in "Decisions" below was taken by me, under instruction to use my own
judgement. Everything in "What needs a human" was deliberately **not** taken,
because it spends money or breaks a client contract that cannot be tested from
this machine.

---

## 1. Decision: the execution engine

**Self-hosted Judge0 v1.13.1 on a dedicated, disposable Compute Engine VM in
`asia-south1`, private IP only, reached from the existing Cloud Run backend over
Direct VPC egress.**

This is not a preference between hosting options. It is the only option that
works, and the elimination is arithmetic on two independent hard requirements:
Judge0 needs a **privileged container**, and it needs a **host booted into
cgroup v1**.

| Option | Verdict | Why |
| --- | --- | --- |
| **Cloud Run** | Impossible | *"Use of `sudo` and `setuid` binaries are not supported in Cloud Run"* — `isolate` is setuid root. Separately: *"There is no Cloud Run equivalent to Docker's `--privileged` mode."* Neither statement is qualified by execution generation. |
| **GKE Autopilot** | Impossible | Rejects privileged pods; self-allowlisting is gated behind Cloud Customer Care eligibility on 1.35+. Also cannot set cgroup v1 on clusters created at 1.26+. |
| **GKE Standard** | Rejected | Works today, on a clock: GKE deprecated cgroup v1 at 1.31, force-migrates to v2 from 1.33, removes it at 1.35. Building on a feature Google is deleting — and it costs *more* than the VM, because the node also carries kube-system pods. |
| **Compute Engine VM** | **Chosen** | You own the kernel command line, so you can set GRUB yourself, and it keeps working. |
| Piston | Rejected | Not an escape hatch: identical `privileged: true`, identical `isolate`, same v1-era `--cg-mem` flag. Changes nothing about hosting, and costs you `expected_output` — so you would write the comparator and the TLE/RE classification yourself. |
| Managed Judge0 cloud | Rejected | Cheaper (~$29/mo at low volume). But every candidate's source code, every stdin, **and your hidden expected outputs** leave TalbotIQ infrastructure and are processed by a third party. For a company under a parent group, that is a data-processing conversation, not a hosting choice. |

**Gen2 does not rescue Cloud Run.** Its "full Linux compatibility" is about
syscall surface relative to gVisor's partial one. That is a different claim from
the privilege and setuid restrictions, which are stated without qualification.

### Cost, with the arithmetic

`asia-south1` (Mumbai) on-demand list prices, 730 hr/month:

| Volume | Machine | Monthly | With 1-yr CUD |
| --- | --- | --- | --- |
| 200 assessments/mo | e2-standard-2 + 50 GiB | **$64.75** | $48.30 |
| 2,000 assessments/mo | e2-standard-4 + 100 GiB | **$129.51** | $96.61 |

`0.08048436 × 730 = $58.75` + `50 × 0.12 = $6.00` → `$64.75`.

**Resist over-provisioning.** At an assumed ~130 judge submissions per assessment
(three problems × ~10 Run clicks against samples + ~5 Submits against the full
set), that is 8.7 CPU-hours/month at low volume and 86.7 at moderate — roughly
**3% of an e2-standard-4**. You are buying availability and isolation, not
throughput. Start at e2-standard-2 and let queue depth, not guesswork, justify an
upgrade. If assessments are confined to business hours, an instance schedule cuts
the VM line to ~$27/mo (the disk bills regardless).

### The host must be worth nothing

This is the part not to compromise on. Judge0 shipped **CVE-2024-29021, CVSS
9.0** — a sandbox escape via SSRF that worked against its **default
configuration**, and the `privileged` flag is precisely what turned a
container-level escape into a host-level one. `isolate`'s own manual says it is
setuid root, that running it in containers is not recommended, and that you
should not share the machine with other workloads.

So: dedicated VM, nothing else on it, no public IP, no service-account scopes
beyond what it needs, and treat it as disposable.

Three hardening items that are **not** defaults and must be set explicitly:

1. `AUTHN_TOKEN` — Judge0 ships with **API authentication disabled**. Anyone who
   can reach port 2358 can execute arbitrary code on your judge.
2. `ALLOW_ENABLE_NETWORK=false` — Judge0 **defaults to letting the API caller
   turn on network access per submission**. This directly contradicts the
   network-isolation requirement, and it was half the precondition for
   CVE-2024-29021.
3. Firewall: ingress only from the backend's VPC connector. No public route.

**Licence:** GPLv3, not AGPL. Running it as an internal network service is not
distribution, so self-hosting behind your own API triggers no source-release
obligation.

**Staleness, stated honestly:** the newest self-hostable release is v1.13.1
(2024-04-18). The public hosted instance runs 1.14.0, which is not available as a
release artifact. You are self-hosting something two years old.

---

## 2. Decision: question import, and the legal line

**No scraper. Not for LeetCode, not for HackerEarth, not for any problem bank.**

Those problems are copyrighted and their terms prohibit scraping; re-serving them
in a commercial product is infringement plus a terms violation. The value the
"paste a URL" idea was reaching for is *speed of getting a question in*, and that
is obtainable without the liability:

1. **Manual / paste authoring (primary).** A problem editor: statement in
   markdown, constraints, I/O format, worked examples, starter code per language,
   test cases (sample and hidden), limits, difficulty, tags, per-case points.
2. **Structured bundle import.** A defined JSON/ZIP shape so a recruiter can
   bring *their own* bank, and so an internal bank can be version-controlled.
3. **URL import only where lawful** — an official API/export, an open licence, or
   content the recruiter confirms they own — behind an explicit rights
   affirmation, defaulting to "paste and edit" rather than fetch.

**Not built in this pass**, deliberately: even the lawful URL path wants a human
sign-off on which sources qualify before code exists that fetches anything.

---

## 3. The finding that changes the shape of the work

There are **seven** interview modes today, not six — `mcq` is already one — so
Coding is genuinely the eighth. The mode list is duplicated across **22
declarations in four languages**, and the seam is badly guarded.

### Adding a mode fails the TypeScript build in seven places

Good news, and the reason this is safer than it sounds: most of these are
exhaustive `Record<TrackType, …>` maps, and `npm run build` runs `tsc` first, so
they are real tripwires rather than silent gaps. The pattern is deliberate — one
map's comment says the bug it exists to kill *"came from a predicate that
enumerated five of six tracks and quietly omitted the sixth"*.

1. `web_version/talbotiq-platform/shared/types.ts` — the `TrackType` union
2. `src/features/interview/systemcheck/requirements.ts` — `Record<TrackType, CheckId[]>`
3. `src/features/interview/deviceRequirements.ts` — exhaustive switch, no default
4. `src/pages/AnalyticsPage.tsx` — `Record<TrackType, string>`
5. `src/features/recruiter/TemplateEditorPage.tsx` — `Record<InterviewTemplate['track'], string>`
   — **indirect, and invisible to a `TrackType` grep.** This is the one that bites.
6. `src/features/interview/preStep.test.ts`
7. `src/features/interview/systemcheck/requirements.test.ts`

### And breaks one thing that will not fail loudly

The golden fixture's `modes` block is **write-only on the Python side** — it is
emitted from `MODE_LABELS` but no Python test asserts it. So adding a mode passes
all 35 backend contract tests while staling the shared contract. The test that
*does* read it is **Dart**, and it fails once fixtures are regenerated:
`RoundKind.fromWire` coerces unknown values to `chat`, so
`fromWire('coding').wire == 'chat' != 'coding'`.

Fixing that needs a `RoundKind.coding` member in the Flutter client — a change
that cannot be tested from this machine.

### Three pre-existing drifts a new mode would inherit

Recorded rather than fixed, because they are not this feature's business:

- `TrackKey` in `tokens.ts` has **six** members and never gained `mcq`, despite a
  comment claiming it is kept in sync with `TrackType` (seven).
- `backend/app/rounds.py` `KINDS` is missing `mcq` entirely, and
  `kind_from_wire` coerces unknowns to `chat` — with a test actively blessing
  that coercion. A coding *round* would silently become a chat round.
- `contracts/design-tokens.json` and `scripts/gen-tokens.mjs` are named as source
  and generator by a "GENERATED FILE — DO NOT EDIT" Dart file that claims a
  `--check` gate blocks hand-edits. **Neither file exists.** That gate is
  fictional.

Also: there is **no CI anywhere in the monorepo**, so every gate named here is a
local command. Nothing enforces them on a push.

### The mobile client

Hard-codes a **three**-item track list and is already four modes behind. It will
not crash on a new mode — an unrecognised value renders as "Timed Q&A (Chat)" —
but a recruiter on mobile cannot select one.

---

## 4. Decision: web surface only, for v1

Because of all of the above, Coding mode is built **entirely on the web surface**
(`app/web/`), not promoted into the shared kernel.

This is not a shortcut. It is the correct call three times over:

- **Nobody sits a coding interview on a phone.** The device-restriction mechanism
  already anticipates this by name — *"a coding-heavy screen that needs a
  keyboard"*.
- It leaves the **frozen mobile contract untouched**: no `MODE_LABELS` edit, so no
  fixture regeneration, so no Dart breakage.
- It avoids adding a module to the kernel allow-list in `tests/test_layering.py`,
  which that test defines as *"a change to the mobile contract requiring review
  against both surfaces"*.

MCQ was promoted to the kernel because both clients needed to sit a paper and the
answer key must not be re-implemented per client. That reasoning does not apply
until a phone can plausibly run an editor.

**Storage** follows the web convention: `web_`-prefixed collections. The decisive
and counter-intuitive rule, from the store's own header: for `web_`-prefixed
collections you must **not** add a Firestore security rule — `firestore.rules`
uses explicit per-collection matches with no catch-all, and Firestore defaults to
deny, so they are already unreachable by any client and written only by the Admin
SDK. Hidden test cases are therefore protected by *default deny*, not by a rule
somebody has to remember to write.

A consequence worth stating: because `web_*` is client-unreadable, a Firestore
`onSnapshot` listener on a judge job is **structurally impossible** on the web
client. HTTP polling is the only option, which is what the existing job pattern
already does.

---

## 5. How hidden test cases are kept from the candidate

Do not invent a mechanism. This repo already solved the identical problem for
MCQ, and the solution is the thing to copy exactly.

`mcq_scoring.mcq_public_question` is an **allow-list, not a strip**, and the
module states why the distinction is the whole security property: *stripping
means listing what to remove, so a field added to the stored question later — a
second key, an ideal-answer note — is exposed by default.* Each question type
gets its own branch naming its own visible fields.

It is pinned by a golden test that asserts an **absence on serialised bytes**,
not on the projected dict, because bytes are what actually reach a candidate:

```python
KEY_FIELDS = ("correctOptionIds", "correctPairs", "explanation", "internalNote")
...
assert field not in payload, f"{field} reached the candidate's paper"
```

Coding mode reuses this shape verbatim. The candidate projection emits sample
cases only; `expectedOutput` on any case, and every hidden case, are absent from
the payload by construction.

One related tripwire to respect: `interviews.CANDIDATE_VISIBLE_RESULT_FIELDS` is
pinned to `{outcome, rank, rankOf, candidateNote}` by a test that names widening
it a *product and privacy decision, not a refactor*. Per-test-case pass/fail
shown **during** an assessment is a different thing from the post-interview
result disclosure, and must not be conflated with it.

---

## 6. The submission flow

There is no queue, broker or worker framework in this backend — no celery, arq,
rq, dramatiq, Cloud Tasks or Pub/Sub — and the entrypoint's own docstring states
that as an architectural position rather than an oversight.

But there is already **one complete production submission→result flow of exactly
the right shape**: `app/web/services/voice_jobs.py` — a Firestore job document
with `IN_PROGRESS`/`COMPLETED`/`FAILED`, TTL applied *on read* (there is no
sweeper to piggyback on), and a size guard against Firestore's 1 MiB document
cap. Driven by `POST` → `BackgroundTasks` → `GET .../jobs/{id}`, polled over
plain HTTP at 4-second intervals.

Coding mode clones that trio rather than inventing anything, and inherits its two
hard-won decisions: an unknown or expired job returns **`FAILED` with HTTP 200,
not 404**, so a client that polls for minutes stops rather than retrying; and
per-case results are serialised to a JSON **string**, because Firestore cannot
store arrays-of-arrays beyond a shallow depth.

Two cautions from the analysis, carried into the design:

- Cloud Run runs with **CPU throttling outside request processing**, so the
  existing fire-and-forget `BackgroundTasks` pattern is on borrowed time. A judge
  poll loop must not assume CPU between requests.
- The shared `httpx` client has generous timeouts and **zero retries**. A judge
  is a network dependency that needs them.

---

## 7. What was built in this pass

Server-side, additive, web surface only, and testable without a judge:

- the problem and test-case record shapes, and their store
- the **candidate projection** — an allow-list, with a golden-bytes test proving
  hidden cases and expected outputs never appear in a candidate payload
- **deterministic, server-side, partial-credit grading**, pure and LLM-free
- the **Judge0 adapter**, written against the verified API and unconfigured by
  default
- the submission job flow, cloned from `voice_jobs`

### The adapter's non-obvious details, all verified against a live instance

- **`base64_encoded=true` is mandatory, not optional.** Compiler diagnostics
  routinely contain non-UTF-8 bytes, and the `GET` **fails outright** rather than
  degrading: `{"error":"some attributes for this submission cannot be converted
  to UTF-8, use base64_encoded=true"}`.
- **Never `wait=true`.** Judge0 says it does not scale, it is disabled on
  official hosts, and it returns 403 there. Poll with backoff.
- `expected_output` is a first-class field, so **Judge0 does the comparison
  server-side** and returns status 3 (Accepted) vs 4 (Wrong Answer). The hidden
  expected output goes to the judge and never to the client.
- The auth token goes in a **header**, never a URI parameter — Judge0's own
  security warning.
- 14 status ids to map, of which the ones that matter: 3 Accepted, 4 Wrong
  Answer, 5 TLE, 6 Compile Error, 7–12 runtime errors, 13 Internal Error.
- **No filesystem, ever.** Source goes over HTTP. This is not merely preferred:
  `tests/test_no_local_storage.py` bans `tempfile`, `shutil`, `mkdtemp` and
  `NamedTemporaryFile` across the whole of `backend/app/`, both surfaces. An
  in-process judge that wrote candidate source to a temp dir **could not be
  merged**. The codebase already forbids the dangerous thing.

**Unconfigured behaviour.** With no `JUDGE0_URL`, the adapter reports "execution
not configured" and **runs nothing** — the same pattern `app/mailer.py` uses for
dry-run and `config.py` uses for absent provider keys. Candidate code never
executes on the app server in any configuration, including the unconfigured one.
The non-negotiable is satisfied, not deferred.

---

## 8. What needs a human

Two things, and only two.

### A. Provision the judge — a spend and a security decision

Stand up the VM per §1, with the three hardening items. **$64.75/month** at low
volume. Then set `JUDGE0_URL` and `JUDGE0_TOKEN` on the Cloud Run service and the
feature comes alive with no code change.

I did not do this. It is an internet-adjacent host running untrusted code, with a
known escape history, on a new recurring bill, and the first hours of its life
should have somebody watching them.

### B. Wire the eighth mode across the clients — an interop event

The seven TypeScript sites in §3 fail the build loudly, so they are safe to do.
The Dart side is not: adding `coding` to `MODE_LABELS` and regenerating fixtures
breaks the Flutter contract test, and neither Flutter nor its tests can be run
from this machine. That change should be made by someone who can run it.

Until then the coding subsystem is complete and dark — routes, storage, grading
and projection all present and tested, with no track that selects it.

### Deliberately out of scope

Flagged rather than built, to avoid over-scoping v1: contest and leaderboard
systems, video proctoring, IDE plugins. The marketing deck is also left alone —
it is a separate six-item taxonomy with a hard-coded count and an exact-order
assertion, so adding a coding panel breaks three assertions at once and needs a
recorded film.
