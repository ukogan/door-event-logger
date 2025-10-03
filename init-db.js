const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
  const client = await pool.connect();

  try {
    console.log('Creating events table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        door_number INTEGER NOT NULL CHECK (door_number >= 1 AND door_number <= 26),
        event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('A_IN', 'A_OUT', 'B_IN', 'B_OUT')),
        timestamp_utc TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
        deleted_at TIMESTAMP NULL
      );
    `);

    console.log('Creating indexes...');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp_utc DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_door ON events(door_number);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_active ON events(deleted_at) WHERE deleted_at IS NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_events_cleanup ON events(created_at) WHERE deleted_at IS NULL;
    `);

    console.log('Database initialized successfully!');

  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
