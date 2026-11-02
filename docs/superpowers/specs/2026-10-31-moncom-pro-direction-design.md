# MonCOM Pro: product direction and roadmap

**Date:** 2026-10-31
**Status:** Draft for approval
**Supersedes:** the phase list in `ROADMAP.md` (phases 5 to 7 and the post-1.0 section). Phases 0 to 4 stay as the record of what shipped.
**Builds on:** `docs/superpowers/specs/2026-08-23-remote-control-design.md` (remote control over a tunnel).

## Intent

MonCOM solved one person's problem: several video walls across a job site had to come up every morning, logged in and laid out the same way, without anyone at the keyboard. The author replaced hand-written Python scripts with MonCOM and now edits a preset instead of a config file.

The bet is that this person is not alone. Control rooms, security desks, ops floors and dashboard kiosks all have walls that today are either started by hand every morning or left running around the clock, wasting energy and drifting in layout as different people rearrange them.

The next stage turns MonCOM from a personal tool into a product that such people can download, trust and pay for. The free app stays the complete answer for one wall. A paid tier covers everything that matters once you run a site: several presets, schedules, awkward applications, and managing all walls from one place.

## Who it is for

- The primary user is the person responsible for a wall who does not write automation: an installer, a facilities or security technician, an ops lead. They can follow a settings page but will not edit JSON or scripts.
- The buyer is usually an organisation with more than one wall, or one wall with an awkward application on it.
- The author is the first user of every feature, running real walls on a job site. Features are validated there before they are called done.

## Goals

- Keep the reason to install free forever: detect monitors, build one preset, auto-launch it on boot, with web auto-login.
- Add a Pro tier that people with a site are glad to pay for, and that never breaks the wall when it is not paid for.
- Run all of a site's walls from one machine, without VNC and without walking to each one.
- Let a wall sleep at night and come up by itself in the morning.
- Make the app trustworthy enough to download without reading the code: tests, signed builds, encrypted secrets, a 1.0 label.
- Offer URL-only walls on Linux and macOS.

## Non-goals

- Live window snapping or per-app window rules. FancyZones owns that, as before.
- Screen streaming or remote viewing. VNC remains the right tool when you need to see the wall.
- Full application-zone parity on Linux and macOS. Not in this roadmap.
- A community marketplace, plugin runtime or scripting layer.

## Anti-goals (what would make this a failure even if it works)

- A free user's wall stops launching, nags, or degrades because they did not pay.
- A paying user's wall fails to launch because the licence server or their internet is down.
- Login credentials for dashboards end up readable on a Flarepoint server.
- The launch path gets slower or less predictable in exchange for any feature below.
- The app grows back into a general window manager.

## Decisions already made

These were settled with the author and are not open to the builder.

| Topic | Decision |
|---|---|
| Free tier | One preset, all zone types, web auto-login, auto-launch on boot, hotkeys and CLI apply. Complete and permanent. |
| Pro tier | More than one preset. Scheduling and power. The stubborn-app profile library (using it and authoring). Remote control and sync across walls. |
| Repo | The repository goes private. Downloads and update feeds move to flarepoint.nl. The public GitHub presence ends. |
| Backend | A Flarepoint hosted service handles accounts, billing, licences, the wall registry, preset sync and remote commands. |
| Pricing unit | Per wall machine, with a site bundle discount. Exact prices are a business decision outside this document. |
| Platforms | Windows remains primary. Linux and macOS get URL-zone walls only. Application zones stay Windows-only. |
| Offline walls | Pro needs connectivity at least once in the grace period. Walls with no internet use the free tier. Offline activation is parked. |
| Secrets key | Per-wall pairing. A wall shows a pairing code once, the desk machine derives a key from it and keeps it in the OS keychain. The server relays blobs it cannot read. |
| Account model | An account is an organisation. Members are invited by email. Two roles: owner (billing, deactivate walls) and member (everything else). |
| Billing shape | Monthly and annual plans. Quantity-based pricing with a volume discount past a threshold, not fixed tiers. No trial, the free tier is the trial. Card only in v1. |
| Code signing | Not before 1.0, to avoid the cost for now. Ship published checksums and a plain SmartScreen explanation. Revisit when revenue exists. |
| Existing infra | A Flarepoint Stripe account (verification nearly complete), flarepoint.nl hosting and DNS under Flarepoint control, a Cloudflare account. No Apple Developer account. |

## Constraints

**The wall always launches.** The entitlement check never sits in front of a launch. The gate is on creating and editing, never on running what is already on the machine. Concretely: every preset, schedule and profile stored on a machine keeps working by hotkey, tray, CLI and schedule whether the machine is free, lapsed or offline. A free or lapsed machine cannot create a second preset, edit or create profiles, create schedules, or pull from the profile library. This rule also grandfathers pre-1.0 installs that already hold several presets or a profile, with no migration needed.

**Offline tolerance.** A wall machine checks its licence opportunistically and stores a signed entitlement locally. The entitlement stays valid for 30 days without contact (author's call, the builder may tune it). A wall never phones home during a launch.

**Secrets never leave the machine readable.** Web login values are stored in plain text in `presets.json` today. Before any sync feature ships, secrets are encrypted at rest with Electron `safeStorage`, and anything synced through the hosted service is encrypted on the client with a key the server never holds. The server stores blobs it cannot read.

**No new runtime dependency without a reason.** The app ships with `electron-store`, `electron-updater` and `koffi`. Each addition is justified in its plan.

**The launch path is sacred.** Nothing in this roadmap adds work to `applyPresetFromMain` between "apply" and "windows placed" except the scheduling trigger that calls it.

**House style stands.** Tooltips and microcopy follow the descriptive voice already used in the editor pages. No internal jargon in the UI.

## Product shape

### Free

Everything a single wall needs. Monitor detection with stable hardware ids, the layout editor with the six templates, URL and application zones, web auto-login steps, coordinate record and replay, one preset, auto-launch on boot, hotkeys, the CLI `--apply` flag, export of the preset to a file, and the auto-updater.

Free users see Pro surfaces in the UI, clearly marked, with a one-line reason and a link. They never see a modal, a countdown or a trial expiry.

### Pro

**Presets.** Unlimited presets. Switching, duplicate and rename, import with monitor remap preview. Where a free user has one preset, a Pro user has a library.

**Scheduling and power.** Per preset: days and times to bring the wall up, and a time to take it down. "Down" means close all zones and put the machine to sleep. "Up" means wake the machine and apply the preset. On Windows this is built on the scheduled task mechanism that `startup-task.ts` already uses, with the wake-to-run flag. Shutdown plus Wake-on-LAN is a later addition driven from the hosted service, not part of the first version. A wall that was asleep must come up logged in, which the existing auto-login path already covers for dashboards.

Windows sign-in on wake is a documented prerequisite: the machine must be set to not ask for a password after sleep. MonCOM does not change that policy itself. The schedule editor states the prerequisite and the Settings page shows a check where Windows exposes one. If sleep proves unreliable on a given wall (Modern Standby, displays that do not wake), the down action may fall back to closing all zones and turning the displays off, chosen per wall in the schedule editor. If the machine boots while a schedule says the wall should be up, the scheduled preset wins over the boot preset. Outside scheduled hours the boot preset applies as today.

**Profile library.** The stubborn-app recipes (Dahua DSS is the first) ship as a curated library pulled from the hosted service, so a fix to a recipe reaches every wall without an app release. Pulling from the library and authoring or editing profiles are Pro. Running a profile that is already on the machine is never gated. The bundled DSS example moves out of the app and into the hosted library when the library ships, so a fresh free install has no recipes, while existing installs keep the one they have. The free app still launches a plain application into a zone.

**Fleet: remote control and sync.** Every Pro wall registers with the account. From any MonCOM instance signed into the account, the operator picks a wall and the full interface drives it, exactly as the August design describes, with one change: the transport goes through the hosted service as a relay instead of requiring the user to set up a Cloudflare tunnel. The tunnel design stays valid for people who already have one, but the product path is "sign in, see your walls". Preset sync lets one preset be pushed to several walls, with the monitor remap preview on each.

Everything that travels between a desk machine and a wall is encrypted with the per-wall pairing key before it reaches the relay. The server stores and forwards blobs. A wall sends a small set of metadata in the clear so the dashboard can work: its name, app version, last seen, whether it is up, and the name of the current preset. Never zone contents or login values.

The desk machine needs no Pro entitlement of its own. Pricing is per wall, so Pro surfaces on the desk follow the entitlement of the wall being controlled, not the local one.

Remote "take down" closes all zones and leaves the machine awake, so it stays reachable. Putting a wall to sleep remotely is a separate, explicitly labelled action that states the wall will be unreachable until its next scheduled wake.

The account web dashboard shows each wall's name, version, last seen, current preset and whether it is up. It is deliberately small: the MonCOM app remains the interface for everything else.

### Hosted service

A small service owned by Flarepoint. Responsibilities, in order of when they are needed:

1. Accounts and sign-in. An account is an organisation with invited members and the two roles above. Sign-in mail needs a transactional email sender on a Flarepoint domain.
2. Billing through Stripe: one quantity-based subscription per organisation where the quantity is the number of walls, monthly or annual, with a volume discount past a threshold. Stripe Tax handles EU VAT and reverse charge from the Dutch entity. Card only in v1. No trial.
3. Entitlement issuance: a signed token per wall machine, renewable, with deactivation from the account dashboard when hardware is replaced. The entitled wall count equals the subscription quantity.
4. Download and update hosting for the private builds.
5. Profile library distribution.
6. Wall registry and relay for remote control.
7. Encrypted preset sync.

The stack is left to the builder, within these limits: it must be cheap to run at ten customers and not embarrassing at a thousand, and it must never need to decrypt user data.

### Linux and macOS

A URL-only wall. The app builds and runs, detects monitors, places its own Electron windows into zones, runs web auto-login, auto-launches on login, and takes part in fleet features. The layout editor hides the application zone type on these platforms with a plain explanation. Native input replay, the recorder and profiles are not available. Stable monitor identity needs a per-platform source, and where none exists the position-based fallback is used.

## Roadmap

Phases are ordered by dependency and by how soon they can earn trust or money. Each phase has a goal and a single "done when" test, as in the existing roadmap. Phases 0 to 4 in `ROADMAP.md` are complete and are not repeated.

### Phase 5: Trustworthy 1.0

**Goal:** Make the free app something a stranger can download and rely on, and freeze it as the permanent free tier.

**Done when:** A tagged 1.0 build installs from flarepoint.nl with a checksum and a SmartScreen explanation, auto-updates from there, passes CI with tests on the zone math, monitor rematch and web-login runner, stores login secrets encrypted, and exports and imports a preset with a monitor remap preview.

- Unit tests and CI for the zone-bounds math, `rematchMonitor` and `migratePresets`, and the web-login step runner. Typecheck on every push.
- Encrypt web-login values at rest with `safeStorage`. Migrate existing presets on first run.
- Preset export and import with monitor remap preview, plus duplicate and rename. Export stays free, import stays free for the single preset.
- Move downloads and the update feed to flarepoint.nl behind Cloudflare. Ship one bridge release on GitHub whose updater points at the new feed, keep the GitHub releases page public for 60 days after that, then make the repository private. Versions from 1.0 onward are proprietary. The MIT history before that stays MIT wherever it was already cloned.
- Unsigned builds stay for now. Publish checksums beside each download and a short, honest SmartScreen page on flarepoint.nl that the installer links to.
- Review the code written with older models: dead paths, duplicated logic, anything the house style now forbids. Not a rewrite. Targeted cleanup with the tests as a safety net.
- Drop the pre-release banner.

### Phase 6: Entitlements

**Goal:** The app knows whether a machine is Pro, without ever blocking a launch.

**Done when:** A machine with no entitlement runs the full free tier. A machine with a valid entitlement unlocks Pro surfaces. Cutting the network or expiring the entitlement past its grace period locks the Pro editing surfaces but the scheduled auto-launch still runs the current preset, verified by test.

- Hosted service v1: accounts, Stripe billing, entitlement tokens, deactivation.
- An entitlement module in the main process: load the local token, refresh in the background, expose a single `isPro()` and a reason string.
- A single gating pattern in the renderer: one component that wraps a Pro surface, shows the marked state for free users, and never appears on the launch path.
- Sign-in from the Settings page. No accounts are required for the free tier.

### Phase 7: Pro on one wall

**Goal:** Ship the Pro features that do not need a second machine, so there is something to pay for before the fleet work lands.

**Done when:** On a single Pro wall, two presets exist, one is scheduled to come up on weekday mornings and go down in the evening, the wall sleeps and wakes on that schedule for five consecutive days, and a Dahua DSS zone launches from the library recipe.

- Multiple presets behind the gate, with the free tier limited to one.
- Scheduling and power: schedule editor per preset, Windows scheduled tasks with wake, sleep at the down time, close all zones first.
- Profile library distribution from the hosted service, with the authoring page gated.

### Phase 8: Fleet

**Goal:** Run every wall on a site from one chair.

**Done when:** From the author's desk machine, each wall on the job site appears in a list with its state, a preset edited once is pushed to three walls with a remap preview on each, and a wall is brought up and taken down remotely, without a tunnel being configured by hand.

- Method registry, classification and job model from the August design.
- Relay through the hosted service. Walls hold an outbound connection. Controllers send commands to a wall by id.
- Wall registry and the small account dashboard.
- Encrypted preset sync and push-to-walls.
- The blocked-while-remote methods behave as the August design states.

### Phase 9: URL walls on Linux and macOS

**Goal:** Reach dashboard-style walls that are not on Windows.

**Done when:** A Linux and a macOS build each bring up a three-monitor URL wall on login, logged in, and appear in the fleet list, with the application zone type hidden and explained.

- Platform seam for monitor identity and auto-launch registration.
- Builds and update feeds for both platforms. macOS notarization needs an Apple Developer account that does not exist yet. That cost is decided when this phase starts, and until then the macOS build is unnotarized with the same honest explanation as SmartScreen.
- Hide and explain the Windows-only features.

### Parked

Not planned, listed so they are not forgotten: shutdown plus Wake-on-LAN, offline activation by licence file for air-gapped walls, code signing and notarization, invoice or purchase-order payment, scenes that switch presets on a trigger, record-to-profile, application zones on Linux and macOS, a public template gallery.

## Left to the builder

- The hosted service stack, hosting provider and database, within the constraints above.
- The entitlement token format and the machine identity it binds to.
- How the profile library is versioned and how the app merges a library update with a user's own edits of the same recipe.
- The relay protocol details beyond what the August design fixes.
- The exact grace period and refresh cadence for entitlements.
- The order of work inside a phase.

## Calls made during review

A builder review raised eleven questions. Six were settled by the author and are in the decisions table (offline walls, secrets key, account model, billing shape, code signing, existing infrastructure). The remaining five were settled by the document's writer as builder-level calls and can be overturned by the author:

- The gate is on creating and editing, never on running. Pre-1.0 installs are grandfathered by that rule.
- The bundled DSS example moves into the hosted library when the library ships.
- Windows sign-in on wake is a documented prerequisite, with displays-off as a per-wall fallback for the down action. A scheduled preset wins over the boot preset during scheduled hours.
- Remote take down leaves the machine awake. Remote sleep is a separate labelled action.
- The desk machine needs no entitlement. One bridge release on GitHub, then 60 days, then private. Proprietary from 1.0.

No open questions remain.
