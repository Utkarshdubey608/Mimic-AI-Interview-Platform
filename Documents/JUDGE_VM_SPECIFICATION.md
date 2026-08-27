# Code-execution judge — exact VM specification for costing

**For:** whoever approves and prices the spend.
**Prepared:** 2026-08-27
**Project:** `interview-project-505700` · **Region:** `asia-south1` (Mumbai)

Every price below comes from Google's **Cloud Billing Catalog API** for
`asia-south1` on the date above, not from a published table or from memory. The
exact SKU rates used are given so the arithmetic can be re-checked.

---

## 1. Why a VM at all, in one paragraph

The judge is Judge0, which sandboxes untrusted candidate code using `isolate`.
`isolate` is a **setuid-root binary** and Judge0 runs its server and workers as
**privileged containers**; it also requires the **host kernel booted into
cgroup v1**. Google Cloud Run states plainly that *"use of `sudo` and `setuid`
binaries are not supported"* and that *"there is no Cloud Run equivalent to
Docker's `--privileged` mode"* — so Cloud Run cannot host it, in either execution
generation. GKE is excluded independently: Autopilot rejects privileged pods, and
GKE deprecated cgroup v1 at 1.31, force-migrates clusters from 1.33 and removes it
at 1.35. A plain Compute Engine VM is the only option on GCP where we control the
kernel command line, which is what makes the requirement satisfiable at all.

The existing FastAPI backend stays on Cloud Run and reaches this VM over the VPC
on a private IP. Nothing about the current deployment changes.

---

## 2. The VM — exact configuration

| Field | Value |
| --- | --- |
| Project | `interview-project-505700` |
| Region / Zone | `asia-south1` / **`asia-south1-a`** |
| Machine family | E2 (general purpose) |
| **Machine type** | **`e2-standard-2`** |
| vCPU | 2 |
| Memory | 8 GiB |
| CPU platform | Automatic (E2 has no minimum-platform choice) |
| **Boot disk type** | **`pd-balanced`** (Balanced Persistent Disk) |
| **Boot disk size** | **50 GiB** |
| Boot disk auto-delete | Yes |
| **OS image** | **`ubuntu-2204-lts`** (Ubuntu 22.04 LTS, x86_64) — *required*, see §6 |
| External IP | **None** (`--no-address`) |
| Network / Subnet | `default` / `default` (asia-south1) |
| Network tier | N/A (no external IP) |
| Network tags | `judge0` |
| IP forwarding | Off |
| Preemptibility / Spot | **Off** — see §8 for why not |
| Shielded VM | Secure Boot **on**, vTPM **on**, Integrity Monitoring **on** |
| Confidential computing | Off (not supported alongside the required config) |
| Deletion protection | Off (the host is deliberately disposable) |
| Snapshot schedule | **None** — see §9 |
| Sole tenancy | No |
| Reservations | Consume any (default) |
| Instance count | **1** |

### Canonical form

The unambiguous specification, as the command that creates it:

```bash
gcloud compute instances create judge0 \
  --project=interview-project-505700 \
  --zone=asia-south1-a \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-type=pd-balanced \
  --boot-disk-size=50GB \
  --boot-disk-device-name=judge0 \
  --no-address \
  --subnet=default \
  --tags=judge0 \
  --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
  --service-account=judge0-runner@interview-project-505700.iam.gserviceaccount.com \
  --scopes=https://www.googleapis.com/auth/logging.write,https://www.googleapis.com/auth/monitoring.write \
  --metadata=enable-oslogin=TRUE
```

---

## 3. Supporting resources

| Resource | Configuration | Cost impact |
| --- | --- | --- |
| **API to enable** | `compute.googleapis.com` — **currently NOT enabled** on this project | none |
| **Service account** | `judge0-runner`, no project roles; scopes limited to `logging.write` + `monitoring.write` | none |
| **Firewall (ingress)** | Allow `tcp:2358` to network tag `judge0`, **source = the Cloud Run service's VPC range only**. No `0.0.0.0/0`. | none |
| **Firewall (egress)** | Deny all egress from tag `judge0` except DNS + the package mirrors needed at build time. Tighten to deny-all after install. | none |
| **Cloud Run → VM** | **Direct VPC egress** (not a Serverless VPC Access connector) | **no extra instances billed** |
| **NAT** | Cloud NAT is needed **only during installation** to pull packages. Delete it afterwards, or install via IAP tunnel. | ~$0.044/hr while it exists |
| **SSH access** | IAP TCP forwarding + OS Login. No public SSH. | none |

> **On the connectivity choice:** Direct VPC egress carries no per-instance
> charge. A Serverless VPC Access connector would instead bill as its underlying
> `e2-micro` instances (minimum 2), which is why it is not recommended here. I
> could not find a distinct billing SKU for connectors to quote an exact figure,
> so treat any connector-based alternative as *approximately* two `e2-micro`
> instances and price it separately if you go that way.

---

## 4. The SKU rates used

Read from the Cloud Billing Catalog API, Compute Engine service `6F81-5844-456A`,
`currencyCode=USD`, on 2026-08-27:

| SKU description | Rate |
| --- | --- |
| E2 Instance Core running in Mumbai | **$0.0261993** per vCPU-hour |
| E2 Instance Ram running in Mumbai | **$0.00351072** per GiB-hour |
| Balanced PD Capacity in Mumbai | **$0.12** per GiB-month |
| *(Spot) E2 Instance Core running in Mumbai* | *$0.01572 per vCPU-hour* |
| *(Spot) E2 Instance Ram running in Mumbai* | *$0.0021060 per GiB-hour* |

---

## 5. Cost — with the arithmetic

730 hours per month, on-demand list price, no discounts applied.

### Recommended: `e2-standard-2` + 50 GiB

```
vCPU     2 × $0.0261993        = $0.0523986  /hr
RAM      8 × $0.00351072       = $0.0280858  /hr
                                 ───────────
compute                          $0.0804844  /hr
         × 730                 = $58.75      /month
disk     50 GiB × $0.12        = $6.00       /month
                                 ───────────
TOTAL                            $64.75      /month
```

### If volume grows: `e2-standard-4` + 100 GiB

```
vCPU     4 × $0.0261993        = $0.1047972  /hr
RAM     16 × $0.00351072       = $0.0561715  /hr
                                 ───────────
compute                          $0.1609687  /hr
         × 730                 = $117.51     /month
disk    100 GiB × $0.12        = $12.00      /month
                                 ───────────
TOTAL                            $129.51     /month
```

**Headline figure to budget: $64.75/month**, one VM, running 24/7.

---

## 6. Constraints that are not negotiable

These are requirements of the software, not preferences. Changing them means the
judge does not work.

1. **Ubuntu 22.04 LTS.** Judge0's own documentation specifies it and gives the
   GRUB edit against it. Do not substitute Debian, COS or Ubuntu 24.04 without
   re-testing — Container-Optimized OS in particular cannot be reconfigured this
   way.
2. **The host is booted into cgroup v1.** `systemd.unified_cgroup_hierarchy=0` is
   added to `GRUB_CMDLINE_LINUX_DEFAULT` and the machine rebooted. This is why it
   must be a VM.
3. **Nothing else runs on this host.** `isolate`'s manual says it is setuid root,
   that running it in containers is not recommended, and that the machine should
   not be shared with other workloads. Judge0 shipped **CVE-2024-29021 (CVSS
   9.0)**, a sandbox escape effective against its *default* configuration, and the
   privileged flag is what turns a container escape into a host escape. Treat this
   host as compromisable and give it nothing worth taking: no data, no broad
   service-account roles, no public IP.

---

## 7. Sizing rationale — please do not over-provision

At an estimated ~130 judge submissions per coding assessment (three problems ×
~10 "Run" presses against samples + ~5 "Submit" runs against the full set):

| Volume | Submissions/month | CPU-hours/month | Utilisation of e2-standard-4 |
| --- | --- | --- | --- |
| 200 assessments | ~26,000 | ~8.7 | ~0.3% |
| 2,000 assessments | ~260,000 | ~86.7 | **~3%** |

**This is not a compute-bound workload at either volume.** `e2-standard-2` covers
both on raw capacity. What you are buying is availability and isolation, not
throughput. Step up to `e2-standard-4` only for burst headroom — fifty candidates
submitting Java or C++ simultaneously during a campus drive, where compiles queue.
Let observed queue depth justify the upgrade, not a forecast.

---

## 8. Why not Spot / preemptible, despite it being 40% cheaper

Spot rates would take the compute line from $58.75 to $35.86/month. It is the
wrong trade here: a preemption gives 30 seconds of notice and can land in the
middle of a candidate's graded submission. The failure is not "a slow judge", it
is **a candidate losing an assessment they cannot re-sit**, during a hiring
decision. Not recommended at any saving.

---

## 9. Legitimate ways to reduce the figure

| Option | Effect | Trade-off |
| --- | --- | --- |
| **1-year committed use discount** | $64.75 → **~$48.30/month** | Locks 12 months |
| **3-year CUD** | → **~$38/month** | Locks 36 months |
| **Instance schedule** (business hours only, ~12×5) | compute $58.75 → **~$21/month**; disk still bills → **~$27/month total** | Candidates cannot sit an assessment out of hours — usually unacceptable for a hiring funnel spanning time zones |
| **No snapshots** | already assumed | The host is disposable and holds no data; it is rebuilt from a script, not restored |

---

## 10. What this estimate does **not** include

Stated so nobody is surprised by the first invoice:

- **Cloud NAT during installation only** (~$0.044/hr while it exists). Delete it
  after the install, or avoid it entirely by installing over an IAP tunnel.
- **Egress.** Same-region traffic between Cloud Run and this VM on internal IPs is
  not billed as internet egress. The judge itself has **no network access** by
  design, so it generates none.
- **Logging/monitoring** beyond the Cloud Logging free tier. This host is quiet;
  expect this to stay inside the free allowance.
- **The existing Cloud Run backend**, unchanged and already budgeted.
- **Judge0 itself** — GPLv3, no licence cost. Running it as an internal service is
  not distribution, so self-hosting triggers no source-release obligation.

---

## 11. One-line summary for an approval form

> One `e2-standard-2` Compute Engine VM (2 vCPU, 8 GiB) with a 50 GiB
> `pd-balanced` boot disk, Ubuntu 22.04 LTS, no external IP, in
> `asia-south1-a` — **US$64.75 per month** at on-demand list price
> (US$48.30 with a 1-year commitment). Requires enabling
> `compute.googleapis.com` on `interview-project-505700`.
