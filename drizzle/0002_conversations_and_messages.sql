DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'general',
  length TEXT NOT NULL DEFAULT 'balanced',
  web_search INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '[]',
  follow_ups TEXT NOT NULL DEFAULT '[]',
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX messages_conversation_id_idx ON messages(conversation_id);
