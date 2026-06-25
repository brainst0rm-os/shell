# Privacy and security

Brainstorm is built local-first. Your data lives on your devices; nothing leaves them unless you explicitly turn on a feature that needs to.

## Local-first

Everything you create — notes, tasks, files, every [entity](concepts/entities.md) — is stored on the machine that wrote it. You don't need an account, an internet connection, or a server. Brainstorm runs offline by default.

## Encryption at rest

Every [vault](concepts/vaults.md) is encrypted on disk with a passphrase you chose at creation time. If your laptop is stolen, the vault folder on the drive is unreadable without the passphrase.

The encryption is AES-256-GCM, with the key derived from your passphrase via a memory-hard function. The passphrase itself never leaves your device.

## Encryption in transit

When you [pair devices](concepts/sync-across-devices.md), the two paired devices establish a shared key during pairing. Everything sent between them after that is encrypted with that key. The relay server that ferries traffic between them sees only encrypted bytes.

If you lose a device, remove it from **Settings → Devices** on another paired device. The remaining devices rotate the shared key so the lost device can't sync any further.

## App permissions

Every [app](concepts/apps.md) — first-party or installed from the [Marketplace](getting-started/install-an-app.md) — declares what it needs to access:

- **Read** entities of a particular type.
- **Write** entities of a particular type.
- **Network access** — talk to a specific server, or any server.
- **Filesystem access** — read files outside the vault.

At install you see the list and approve or deny each item. You can change your mind later in **Settings → Apps** → an app → **Permissions**.

An app can't reach anything you haven't granted it. A note-taking app can't read your tasks unless you've granted `read tasks`; it can't talk to the internet unless you've granted network.

## Telemetry

By default, Brainstorm sends no usage data. You can opt in to crash reports in **Settings → Privacy** if you want to help us debug — crash reports are stripped of personal data before they're sent, and the option is off until you turn it on.

## Your data, exportable

Whatever you put in, you can take out. **Settings → Data → Export** writes your vault as a folder of Markdown files plus JSON for everything that isn't text. Use it for backups, for moving to a different tool, or just to know you can.
