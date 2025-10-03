# Door Event Logger

Mobile-optimized web application for recording ground truth entry/exit events across 26 doors. Used for validating automated entry/exit counter systems by comparing human-recorded events against sensor data.

## Features

- ✅ **Mobile-First Design** - Optimized for iPhone and Android devices
- ✅ **26 Doors × 4 Event Types** - A In, A Out, B In, B Out (104 total buttons)
- ✅ **Touch Optimized** - Large tap targets, haptic feedback, smooth animations
- ✅ **Long-Press Undo** - Hold button for 2 seconds to delete last event
- ✅ **Real-time Logging** - Recent events display with auto-refresh
- ✅ **CSV Export** - Download all events for analysis
- ✅ **Concurrent Users** - Multiple people can log simultaneously
- ✅ **7-Day Retention** - Automatic cleanup of old data
- ✅ **Server-Side Timestamps** - UTC timestamps from server (not client)

## Tech Stack

- **Frontend**: Vanilla JavaScript (single HTML file)
- **Backend**: Express.js + Node.js
- **Database**: PostgreSQL with connection pooling
- **Deployment**: Railway

## Deployment to Railway

### Prerequisites

- [Railway Account](https://railway.app) (free tier works)
- GitHub repository

### Step 1: Create GitHub Repository

```bash
cd time_stamper
git init
git add .
git commit -m "Initial commit: Door event logger"
gh repo create door-event-logger --public --source=. --push
```

### Step 2: Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `door-event-logger` repository
5. Railway will auto-detect Node.js and deploy

### Step 3: Add PostgreSQL Database

1. In your Railway project, click **"New"** → **"Database"** → **"PostgreSQL"**
2. Railway will automatically set `DATABASE_URL` environment variable

### Step 4: Initialize Database

1. In Railway dashboard, go to your app service
2. Click **"Settings"** → **"Deploy"** → **"Custom Start Command"**
3. Temporarily set start command to: `npm run init-db && npm start`
4. Wait for deployment to complete (this runs the database migration)
5. Change start command back to: `npm start`
6. Redeploy

**Alternative**: Use Railway's terminal to run `npm run init-db` manually

### Step 5: Access Your App

1. In Railway, click your app service
2. Click **"Settings"** → **"Generate Domain"**
3. Your app will be available at: `https://your-app.up.railway.app`

### Environment Variables (Optional)

Railway auto-sets these, but you can customize:

- `PORT` - Auto-set by Railway
- `DATABASE_URL` - Auto-set by Railway
- `NODE_ENV` - Set to `production`
- `DATA_RETENTION_DAYS` - Defaults to 7

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL (local or cloud)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your local DATABASE_URL
```

3. Initialize database:
```bash
npm run init-db
```

4. Start server:
```bash
npm run dev
```

5. Open browser: `http://localhost:8000`

## Usage

### Recording Events

1. **Tap** a button to record an event (green flash confirms)
2. **Hold** a button for 2 seconds to undo the last event (red swipe confirms)
3. Recent events auto-refresh every 5 seconds
4. Tap **"Export CSV"** to download all data

### Event Types

- **A In** - Person/object enters through sensor A
- **A Out** - Person/object exits through sensor A
- **B In** - Person/object enters through sensor B
- **B Out** - Person/object exits through sensor B

### Data Retention

- Events are automatically deleted after **7 days**
- Cleanup job runs daily at 00:00 UTC
- Soft deletes (undo) are permanent after 7 days

## API Endpoints

### POST `/api/events`
Record a new event
```json
{
  "door_number": 5,
  "event_type": "A_IN"
}
```

### DELETE `/api/events/:id`
Soft delete an event (undo)

### GET `/api/events/recent?limit=10`
Get recent events

### GET `/api/events/export`
Download all events as CSV

## Database Schema

```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  door_number INTEGER NOT NULL CHECK (door_number >= 1 AND door_number <= 26),
  event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('A_IN', 'A_OUT', 'B_IN', 'B_OUT')),
  timestamp_utc TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
  deleted_at TIMESTAMP NULL
);
```

## Mobile Optimization

- Touch targets: Minimum 48×48px
- Prevents accidental zoom and text selection
- Haptic feedback on undo (if device supports)
- Optimized for portrait and landscape
- Auto-refresh with low bandwidth usage
- Offline detection (coming soon)

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is set in Railway dashboard
- Check PostgreSQL service is running
- Review Railway logs for connection errors

### Events Not Recording
- Check browser console for API errors
- Verify backend is running: `https://your-app.up.railway.app/health`
- Test API directly: `POST /api/events` with curl

### Long-Press Not Working
- Ensure you're testing on a touch device or using Chrome DevTools device emulation
- Check console for touch event errors
- Try adjusting `LONG_PRESS_DURATION` in `index.html`

### CSV Export Empty
- Verify events exist: `GET /api/events/recent`
- Check data retention (events >7 days are deleted)
- Review server logs for export errors

## Architecture

See [architecture.md](architecture.md) for detailed system design.

See [RISKS.md](RISKS.md) for risk assessment and mitigation strategies.

## License

MIT

## Support

For issues or questions, open a GitHub issue in the repository.
