# Time Stamper - Architecture Document

**Version**: 1.0
**Last Updated**: 2025-10-03
**Architecture Change Counter**: 0

## Project Overview

A mobile-optimized web application for recording ground truth entry/exit events across 26 doors with 4 event types (A In, A Out, B In, B Out). Used for validating automated entry/exit counter systems by comparing human-recorded events against sensor data.

**Key Requirements**:
- Multiple simultaneous users clicking concurrently
- Mobile-first design (iPhone/Android optimized)
- 7-day data retention with automatic cleanup
- Full data export to CSV

## Tech Stack

**Language**: JavaScript (Node.js 18+)
**Frontend**: Single HTML file with embedded CSS/JavaScript (mobile-first responsive)
**Backend**: Express.js (Node.js)
**Database**: PostgreSQL 14+ with connection pooling
**Deployment**: Railway (app + database)
**Repository**: GitHub (public)

## System Architecture

### Frontend (Mobile-First Single Page Application)
- **File**: `index.html`
- **Dependencies**: Vanilla JavaScript (no framework)
- **Mobile Optimizations**:
  - Viewport meta tag for proper mobile scaling
  - Touch event handling (touchstart, touchend, touchmove)
  - Large touch targets (min 44×44px per Apple HIG)
  - Prevents accidental zooming
  - Optimized for portrait orientation
  - Fast tap response (<100ms feedback)

- **Responsibilities**:
  - Render 26×4 grid of touch-optimized buttons
  - Handle touch events and long-press (2s) for undo
  - Visual feedback (green flash on record, red swipe animation on undo)
  - Display recent events log (last 10)
  - Export all data to CSV (full download)
  - Real-time communication with backend API
  - Optimistic UI updates with error rollback

### Backend (Express.js Server)
- **File**: `server.js`
- **Port**: 8000 (Railway will override with PORT env var)
- **Responsibilities**:
  - RESTful API endpoints for event CRUD operations
  - PostgreSQL connection pooling (max 20 connections for concurrent users)
  - CORS configuration for open access
  - Daily data cleanup job (deletes events > 7 days old)
  - Error handling and logging
  - Request validation middleware

### Database (PostgreSQL)
- **Schema**: Single table `events`
- **Managed by**: Railway PostgreSQL service
- **Connection**: Via DATABASE_URL environment variable
- **Connection Pool**: 10-20 connections for concurrent access
- **Data Retention**: 7 days (automatic cleanup via cron job)

## Database Schema

### Table: `events`

```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    door_number INTEGER NOT NULL CHECK (door_number >= 1 AND door_number <= 26),
    event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('A_IN', 'A_OUT', 'B_IN', 'B_OUT')),
    timestamp_utc TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    deleted_at TIMESTAMP NULL
);

CREATE INDEX idx_events_timestamp ON events(timestamp_utc DESC);
CREATE INDEX idx_events_door ON events(door_number);
CREATE INDEX idx_events_active ON events(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_events_cleanup ON events(created_at) WHERE deleted_at IS NULL;
```

**Columns**:
- `id`: Auto-incrementing primary key
- `door_number`: 1-26
- `event_type`: 'A_IN', 'A_OUT', 'B_IN', 'B_OUT'
- `timestamp_utc`: UTC timestamp of button click (server-side for accuracy)
- `created_at`: Audit trail for when record was created
- `deleted_at`: Soft delete timestamp (NULL = active, non-NULL = deleted via undo)

**Data Retention**: Events older than 7 days are permanently deleted daily at 00:00 UTC

## API Endpoints

### POST `/api/events`
**Purpose**: Record a new event
**Concurrency**: Handles simultaneous requests via database transactions
**Request Body**:
```json
{
  "door_number": 5,
  "event_type": "A_IN"
}
```
**Response** (201 Created):
```json
{
  "id": 123,
  "door_number": 5,
  "event_type": "A_IN",
  "timestamp_utc": "2025-10-03T18:45:23.123Z"
}
```

### DELETE `/api/events/:id`
**Purpose**: Soft delete an event (undo)
**Response**: 204 No Content

### GET `/api/events/recent?limit=10`
**Purpose**: Get recent events (excluding deleted)
**Response**:
```json
{
  "events": [
    {
      "id": 123,
      "door_number": 5,
      "event_type": "A_IN",
      "timestamp_utc": "2025-10-03T18:45:23.123Z"
    }
  ]
}
```

### GET `/api/events/export`
**Purpose**: Export ALL non-deleted events (within 7-day window) as CSV
**Response**: CSV file download
**Headers**: `Content-Disposition: attachment; filename="door_events_YYYYMMDD_HHMMSS.csv"`
```csv
id,door_number,event_type,timestamp_utc
123,5,A_IN,2025-10-03T18:45:23.123Z
124,3,B_OUT,2025-10-03T18:45:25.456Z
```

### POST `/api/cleanup` (Internal - called by cron)
**Purpose**: Delete events older than 7 days
**Response**: `{ "deleted_count": 42 }`

## Mobile-First UI/UX Specifications

### Responsive Layout
- **Mobile Portrait** (320-428px): Single column, scrollable grid
- **Mobile Landscape** (568-926px): Optimized for landscape viewing
- **Tablet** (768px+): Multi-column layout
- **Desktop** (1024px+): Full grid view

### Button Grid Layout
- **Structure**: 26 rows (doors) × 4 columns (event types) = 104 buttons
- **Touch Targets**: Minimum 48×48px (larger on mobile)
- **Spacing**: 8px gaps to prevent mis-taps
- **Header**: Sticky header with column labels (A In, A Out, B In, B Out)
- **Door Column**: Sticky left column with door numbers (1-26)
- **Scrolling**: Vertical scroll for all 26 doors

### Button States & Touch Interactions

**Visual States**:
1. **Normal**: Blue/neutral button with clear label
2. **Touch Active**: Darker shade (immediate feedback)
3. **Recording**: Green flash animation (300ms)
4. **Long Press Progress**: Circular progress indicator (0-2s)
5. **Undo**: Red swipe animation (500ms)

**Touch Events**:
- **Tap (< 200ms)**: Record event
- **Long Press (2s hold)**: Delete most recent event for that specific button
  - Visual countdown shows progress
  - Release before 2s cancels undo
  - Haptic feedback on completion (if available)

### Recent Events Log
- **Display**: Last 10 events in reverse chronological order
- **Format**: `HH:MM:SS - Door X, Event Type`
- **Auto-refresh**: Updates after each event (polling every 5s)
- **Mobile**: Collapsible panel to save screen space
- **Deleted Events**: Brief strikethrough animation when undone

### Data Export
- **Button**: Fixed position "Export CSV" button (always accessible)
- **Downloads**: ALL events (not just visible ones) within 7-day retention window
- **Filename**: `door_events_YYYYMMDD_HHMMSS.csv`
- **Mobile**: Triggers native browser download

### Mobile-Specific Optimizations
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
```

- Prevent double-tap zoom
- Disable text selection on buttons
- Use `-webkit-tap-highlight-color` to customize tap feedback
- Add PWA manifest for "Add to Home Screen" capability

## Deployment Architecture

### Railway Configuration
- **Service 1**: Node.js app (auto-detected from package.json)
- **Service 2**: PostgreSQL database (provisioned add-on)
- **Environment Variables**:
  - `DATABASE_URL`: Auto-set by Railway (includes connection pooling)
  - `PORT`: Auto-set by Railway (defaults to 8000 in code)
  - `NODE_ENV`: production
  - `DATA_RETENTION_DAYS`: 7

### Scheduled Jobs (Node-Cron)
- **Daily Cleanup**: Runs at 00:00 UTC daily
- **Job**: DELETE FROM events WHERE created_at < NOW() - INTERVAL '7 days'
- **Logging**: Records deletion count for monitoring

### GitHub Repository
- **Name**: `door-event-logger` (suggested)
- **Visibility**: Public
- **Branch Protection**: Use PR workflow per CLAUDE.md guidelines
- **README**: Deployment instructions, Railway setup, API docs

## Features to Implement

### Phase 1: Core Functionality (MVP)
- [ ] Database schema and migration script
- [ ] Express.js server with connection pooling
- [ ] API endpoints (POST, DELETE, GET recent)
- [ ] Frontend: Mobile-first responsive grid
- [ ] Frontend: Touch event handling for clicks
- [ ] Frontend: Recent events display
- [ ] PostgreSQL integration with connection pool
- [ ] Basic error handling

### Phase 2: Enhanced Mobile UX
- [ ] Visual feedback animations (green flash)
- [ ] Long-press undo functionality (2s hold with progress indicator)
- [ ] Red swipe animation on undo
- [ ] Touch optimizations (prevent zoom, text selection)
- [ ] Sticky header/column for mobile scrolling
- [ ] Haptic feedback (if supported)

### Phase 3: Data Management
- [ ] CSV export functionality (full data download)
- [ ] 7-day data retention with automated cleanup job
- [ ] Enhanced recent events log (auto-refresh)
- [ ] Loading states and error messages

### Phase 4: Deployment & Polish
- [ ] Railway deployment configuration
- [ ] GitHub repository setup
- [ ] README with deployment instructions
- [ ] PWA manifest for "Add to Home Screen"
- [ ] Production testing on multiple mobile devices
- [ ] Performance optimization for concurrent users

## Concurrency & Performance

### Handling Simultaneous Clicks
- **Database**: PostgreSQL ACID properties ensure no data loss
- **Connection Pool**: 10-20 connections to handle burst traffic
- **Transactions**: Each INSERT wrapped in transaction
- **Optimistic Locking**: Not needed (append-only operations)
- **Race Conditions**: Undo only affects most recent event per specific button (door + event_type combo)

### Expected Load
- **Peak Users**: 5-10 simultaneous testers
- **Click Rate**: ~1-2 clicks/second during active testing
- **Database Size**: ~10K events/day × 7 days = 70K rows (minimal storage)

## Security Considerations

- **Open Access**: No authentication required (as specified)
- **SQL Injection**: Use parameterized queries only
- **CORS**: Enable for all origins (open access app)
- **Rate Limiting**: Not implemented initially (can add if abuse occurs)
- **Data Validation**:
  - Server-side validation of door_number (1-26)
  - Server-side validation of event_type (A_IN, A_OUT, B_IN, B_OUT)
  - Reject malformed requests with 400 Bad Request

## Risk Assessment (see RISKS.md for details)

1. **Concurrent Clicks**: Multiple users clicking same button simultaneously
2. **Mobile Browser Compatibility**: Touch event differences between iOS/Android
3. **Network Latency on Mobile**: Slow cellular connections
4. **Accidental Undo**: User holds button unintentionally
5. **Data Loss**: Railway database restarts during deployment
6. **Clock Skew**: Client-side timestamps unreliable across devices

## Data Flow

```
User Touch Event
    ↓
Frontend detects touch (touchstart/touchend)
    ↓
Optimistic UI update (green flash)
    ↓
POST /api/events {door, type}
    ↓
Server validates input
    ↓
Server records timestamp_utc (server time, not client)
    ↓
INSERT into PostgreSQL (with transaction)
    ↓
Return event with ID + server timestamp
    ↓
Frontend confirms success, updates recent events
    ↓
(If error: rollback UI flash, show error toast)
```

## Testing Strategy

- **Manual Testing**: Primary method (this is a testing tool itself)
- **Multi-Device**: Test on iPhone, Android, iPad
- **Concurrent Access**: Multiple people clicking simultaneously
- **Network Conditions**: Test on slow cellular (throttled)
- **Database Queries**: Verify event counts match UI
- **Export Validation**: Verify CSV contains all events
- **Undo Logic**: Test undo only affects correct button's most recent event
- **Data Retention**: Verify 7-day cleanup works correctly

## Maintenance Notes

- Database auto-cleans daily (events > 7 days deleted)
- Monitor Railway database size (should stay < 100MB)
- Check cleanup job logs for errors
- Railway free tier: 500 hours/month (sufficient for testing tool)
