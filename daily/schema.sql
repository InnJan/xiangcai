CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  player TEXT NOT NULL,
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0),
  submitted INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_day_player_score
  ON entries(day, player, score DESC, submitted);
