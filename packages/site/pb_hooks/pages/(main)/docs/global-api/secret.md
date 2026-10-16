---
title: secret, sign and unsign - Keys and Signatures
description: Keys that belong to your app and survive restarts, and signatures made with them, for plugins and pages that need to protect something.
---

# `secret`, `sign` and `unsign` - Keys and Signatures

- **Type**:
  ```typescript
  secret: (purpose: string) => string
  sign: (value: string, purpose?: string) => string
  unsign: (signed: string, purpose?: string) => string | undefined
  ```
- **Description**: Keys derived from a secret of your app, and signatures made with them. Plugins use them for sessions, CSRF tokens and the like; you can use them for anything you need to hand to a browser and trust when it comes back.

## Where the secret comes from

The secret of the app is, in this order:

1. the **`POCKETPAGES_SECRET`** environment variable, when it is set (at least 16 characters)
2. the secret PocketBase signs the tokens of superusers with. It lives in the database and doesn't change unless you regenerate it.
3. a random one, which lasts until the next restart. PocketPages logs a warning when it has to settle for this.

Either of the first two survives restarts and is the same in every JS runtime PocketBase uses. Nothing is configured by default, and that is secure: the second one is a secret nobody sees.

Set `POCKETPAGES_SECRET` if you run more than one instance of PocketBase against the same data, or if you want to rotate the secret of PocketPages without invalidating the tokens of your superusers. Rotating it invalidates what was signed with it (sessions, CSRF tokens).

## `secret(purpose)`

Returns a key of 64 hexadecimal characters that belongs to your app and to `purpose`. The same purpose gives the same key every time, and different purposes give unrelated keys, so a key made for one use can't be used to forge another's.

```javascript
const key = secret('newsletter')
```

Use a key for `$security.hs256()` (HMAC), or its first 32 characters for `$security.encrypt()`.

## `sign(value, purpose?)` and `unsign(signed, purpose?)`

`sign()` returns `value.signature`: anyone can read the value, only your app can have made the signature. `unsign()` returns the value if the signature is right, and `undefined` if it isn't or was made for another purpose.

```javascript
// Pages/+get.js: a link that unsubscribes without a password
const link = `/unsubscribe/${sign(user.id, 'unsubscribe')}`

// Pages/unsubscribe/[token]/+load.js
const userId = unsign(params.token, 'unsubscribe')
if (!userId) throw new BadRequestError()
```

Values can hold any characters, dots included. The signature is checked in constant time.

**Signed is not secret.** The value is readable. To keep it from the browser too, encrypt it before you sign it (`$security.encrypt(value, secret('purpose').slice(0, 32))`), and when you read it back **verify the signature first**: `$security.decrypt()` panics on input that wasn't made by `encrypt()`, and that can't be caught.

**Signed is not expiring.** Put an expiry in the value (`${userId}.${expiresAt}`) and check it after `unsign()`.
