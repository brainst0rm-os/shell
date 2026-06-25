# Create your first vault

A **vault** is where all your work lives — notes, tasks, files, settings, every entity an app saves. One vault is one workspace. You can have several.

## Create a vault

1. Open Brainstorm. If you don't have any vaults yet, the welcome screen asks you to make one.
2. Pick a folder on your disk where the vault should live. An external drive works; a synced folder (iCloud, Dropbox) is not recommended — sync conflicts can corrupt the vault. Use [device pairing](../concepts/sync-across-devices.md) instead.
3. Give the vault a name and a passphrase. The passphrase encrypts your data at rest. You can't recover it — write it down somewhere safe.

That's it. The vault opens and you land on the dashboard.

## Switching vaults

The vault name lives in the top-left of the dashboard. Click it to switch to another vault or create a new one.

## Where's my data?

Inside the folder you picked. You don't normally need to look in there — Brainstorm manages it. If you do peek, you'll see a few SQLite files and a binary store for documents. Don't edit those by hand.

To back up a vault, copy the whole folder while Brainstorm is closed. To move it, copy the folder, point Brainstorm at the new location, and the old one can be deleted.

## Per-vault settings

Some preferences travel with the vault — themes, keyboard shortcuts you've rebound, the apps you've installed. Others are per-device — window size, last open vault. Open **Settings** from the dashboard header to see them all.
