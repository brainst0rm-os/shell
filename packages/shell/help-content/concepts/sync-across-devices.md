# Sync across devices

A [vault](./vaults.md) lives on one machine by default. If you want it on your laptop and your phone, or on two computers, pair the devices.

## Pairing

On the first device, open **Settings → Devices** and click **Pair a new device**. You'll see a QR code and a short verification code.

On the second device, install Brainstorm and pick **Pair with an existing vault**. Scan the QR code (phones) or type the verification code (desktops). After a moment the two devices match codes — confirm on both, and they're paired.

## How sync works

Your data is encrypted end-to-end. The relay server (which moves bytes between your devices when they can't see each other on the LAN) only ever sees encrypted blobs — it can't read your notes, your tasks, your files. Decryption keys live only on your paired devices.

When two devices are on the same network, they sync directly to each other. When they're not, they go through the relay.

## Offline edits

Both devices can edit at the same time, including offline. When they reconnect, the edits merge. Two people typing into the same note end up with both their changes; two devices changing the same property keep the most recent.

Sync is **not** a substitute for backup. If you want a backup, copy the vault folder somewhere safe periodically — see [Vaults](./vaults.md).

## Unpairing

Open **Settings → Devices** on either device and remove the one you no longer want. The removed device keeps its local copy of the data; the removal just stops future sync.

If a device is lost or stolen, remove it immediately. The other devices will rotate the shared keys so the lost device can't sync further changes.
