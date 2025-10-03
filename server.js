const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;
const DATA_RETENTION_DAYS = process.env.DATA_RETENTION_DAYS || 7;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Data retention: ${DATA_RETENTION_DAYS} days`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});
