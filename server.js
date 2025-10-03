const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_RETENTION_DAYS = process.env.DATA_RETENTION_DAYS || 7;

// Database connection pool
// Use Railway's private network URL if available, fallback to public DATABASE_URL
const databaseUrl = process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL;

console.log('Environment check:');
console.log('- DATABASE_PRIVATE_URL exists:', !!process.env.DATABASE_PRIVATE_URL);
console.log('- DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('- Using database URL:', databaseUrl ? 'Found' : 'MISSING!');

if (!databaseUrl) {
  console.error('FATAL: No DATABASE_URL or DATABASE_PRIVATE_URL environment variable found!');
  console.error('Please add a PostgreSQL database in Railway and link it to this service.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Auto-initialize database on startup
async function initializeDatabaseIfNeeded() {
  const client = await pool.connect();
  try {
    // Check if events table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'events'
      );
    `);

    if (!tableCheck.rows[0].exists) {
      console.log('Events table not found. Initializing database...');

      await client.query(`
        CREATE TABLE events (
          id SERIAL PRIMARY KEY,
          door_number INTEGER NOT NULL CHECK (door_number >= 1 AND door_number <= 26),
          event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('A_IN', 'A_OUT', 'B_IN', 'B_OUT')),
          timestamp_utc TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
          created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
          deleted_at TIMESTAMP NULL
        );
      `);

      await client.query(`CREATE INDEX idx_events_timestamp ON events(timestamp_utc DESC);`);
      await client.query(`CREATE INDEX idx_events_door ON events(door_number);`);
      await client.query(`CREATE INDEX idx_events_active ON events(deleted_at) WHERE deleted_at IS NULL;`);
      await client.query(`CREATE INDEX idx_events_cleanup ON events(created_at) WHERE deleted_at IS NULL;`);

      console.log('Database initialized successfully!');
    } else {
      console.log('Events table already exists.');
    }
  } catch (error) {
    console.error('Error checking/initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Create new event
app.post('/api/events', async (req, res) => {
  const { door_number, event_type } = req.body;

  // Validation
  if (!door_number || !event_type) {
    return res.status(400).json({ error: 'door_number and event_type are required' });
  }

  if (door_number < 1 || door_number > 26) {
    return res.status(400).json({ error: 'door_number must be between 1 and 26' });
  }

  if (!['A_IN', 'A_OUT', 'B_IN', 'B_OUT'].includes(event_type)) {
    return res.status(400).json({ error: 'event_type must be A_IN, A_OUT, B_IN, or B_OUT' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO events (door_number, event_type, timestamp_utc, created_at)
       VALUES ($1, $2, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
       RETURNING id, door_number, event_type, timestamp_utc`,
      [door_number, event_type]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// API: Soft delete event (undo)
app.delete('/api/events/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE events
       SET deleted_at = NOW() AT TIME ZONE 'UTC'
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found or already deleted' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// API: Get recent events
app.get('/api/events/recent', async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  try {
    const result = await pool.query(
      `SELECT id, door_number, event_type, timestamp_utc
       FROM events
       WHERE deleted_at IS NULL
       ORDER BY timestamp_utc DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ events: result.rows });
  } catch (error) {
    console.error('Error fetching recent events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// API: Get most recent event for specific button (for undo)
app.get('/api/events/last', async (req, res) => {
  const { door_number, event_type } = req.query;

  if (!door_number || !event_type) {
    return res.status(400).json({ error: 'door_number and event_type are required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, door_number, event_type, timestamp_utc
       FROM events
       WHERE door_number = $1 AND event_type = $2 AND deleted_at IS NULL
       ORDER BY timestamp_utc DESC
       LIMIT 1`,
      [door_number, event_type]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No events found for this button' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching last event:', error);
    res.status(500).json({ error: 'Failed to fetch last event' });
  }
});

// API: Export all events as CSV
app.get('/api/events/export', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, door_number, event_type, timestamp_utc
       FROM events
       WHERE deleted_at IS NULL
       ORDER BY timestamp_utc DESC`
    );

    // Generate CSV
    const headers = 'id,door_number,event_type,timestamp_utc\n';
    const rows = result.rows.map(row =>
      `${row.id},${row.door_number},${row.event_type},${row.timestamp_utc.toISOString()}`
    ).join('\n');

    const csv = headers + rows;

    // Generate filename with current timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `door_events_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting events:', error);
    res.status(500).json({ error: 'Failed to export events' });
  }
});

// API: Cleanup old events (called by cron job)
app.post('/api/cleanup', async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM events
       WHERE created_at < NOW() - INTERVAL '${DATA_RETENTION_DAYS} days'
       RETURNING id`
    );

    const deletedCount = result.rowCount;
    console.log(`Cleanup job: Deleted ${deletedCount} events older than ${DATA_RETENTION_DAYS} days`);

    res.json({ deleted_count: deletedCount });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// Schedule daily cleanup at 00:00 UTC
cron.schedule('0 0 * * *', async () => {
  console.log('Running scheduled cleanup job...');
  try {
    const result = await pool.query(
      `DELETE FROM events
       WHERE created_at < NOW() - INTERVAL '${DATA_RETENTION_DAYS} days'
       RETURNING id`
    );
    console.log(`Cleanup job completed: Deleted ${result.rowCount} events`);
  } catch (error) {
    console.error('Scheduled cleanup failed:', error);
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function startServer() {
  try {
    // Initialize database if needed
    await initializeDatabaseIfNeeded();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Data retention: ${DATA_RETENTION_DAYS} days`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});
