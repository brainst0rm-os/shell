# Vaults

A **vault** is one workspace. One folder on disk holds everything in it — your notes, your tasks, your files, the apps you've installed, the themes you've picked, the shortcuts you've rebound.

## One vault, many vaults

Most people use one vault for personal work and maybe a second for a job or a project. There's no limit. Switch between them from the vault name in the top-left of the dashboard.

Vaults don't share data. A note in your personal vault isn't visible from your work vault. The two are independent workspaces that happen to use the same app.

## Encrypted at rest

Everything in your vault is encrypted on disk with a passphrase you chose when you created it. If someone copies the folder off your machine without your passphrase, they get noise.

If you forget the passphrase, your data is unrecoverable. Write it down somewhere safe.

## Moving and backing up

To back up: close Brainstorm, copy the vault folder somewhere safe. That's it.

To move to a new machine or drive: copy the folder, then in Brainstorm pick **Open vault** and point at the new location.

Don't put a vault inside a synced folder (iCloud, Dropbox, Google Drive). Those services don't understand the file format and can corrupt the vault by syncing mid-write. For multi-device, use [device pairing](./sync-across-devices.md) — it's designed for this.

## What's inside

You don't normally need to look. If you do, you'll find a few SQLite database files and a folder of document data. The shape is documented and stable, but the on-disk format isn't a user-facing surface — don't edit it by hand.
