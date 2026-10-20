module.exports = {
  name: '042_attendance_segments',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS attendance_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendance_record_id INTEGER NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK (seq >= 1),
      check_in_time TEXT NOT NULL, check_in_ip TEXT,
      check_out_time TEXT, check_out_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(attendance_record_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_segments_record ON attendance_segments(attendance_record_id);`);
  },
};
