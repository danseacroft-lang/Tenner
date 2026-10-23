-- Tenner accounts (Cloudflare D1). Applied by the deploy workflow on every deploy: each statement only creates what's missing.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,              -- random, never shown
  name TEXT NOT NULL DEFAULT '',
  picture TEXT,                     -- a Google profile picture, if they signed in with Google
  hue INTEGER NOT NULL DEFAULT 210, -- the colour of their initials otherwise
  google_sub TEXT UNIQUE,           -- Google's number for them, if linked
  email TEXT,                       -- from Google only, to show which Google account is linked
  share_id TEXT UNIQUE,             -- their public Watchlist link, while sharing is on
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,              -- the credential ID (base64url)
  user_id TEXT NOT NULL,
  jwk TEXT NOT NULL,                -- the public key
  alg INTEGER NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  used INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,           -- a hash of the token; the token itself lives only on the device
  user_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT,                     -- set when adding a passkey to an account, or for a new account's ID
  name TEXT,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS userdata (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,               -- Watchlist, progress, services and settings (JSON)
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pushsubs (
  sub_key TEXT PRIMARY KEY,         -- the alerts store's key for a device
  user_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pushsubs_user ON pushsubs(user_id);
CREATE TABLE IF NOT EXISTS passwords (  -- email and password sign-in
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,           -- lower case
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,                   -- a hash of the key the browser stretched from the password (never the password)
  fails INTEGER NOT NULL DEFAULT 0,
  fail_at INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS resets (     -- "Forgot password?" links, for an hour each
  token TEXT PRIMARY KEY,               -- a hash of the token in the link
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verified (   -- email addresses whose owners clicked the link we sent
  email TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS verifies (   -- "Confirm your email" links, for a day each
  token TEXT PRIMARY KEY,               -- a hash of the token in the link
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
-- passwords made before email checks began count as checked
INSERT OR IGNORE INTO verified (email, user_id, at) SELECT email, user_id, created FROM passwords WHERE created < 1792755100000;
