# Risk Assessment - Door Event Logger

**Last Updated**: 2025-10-03

## High Priority Risks

### 1. Concurrent Click Data Integrity
**Risk**: Multiple users click the same button simultaneously, causing data loss or duplication

**Likelihood**: High (5-10 simultaneous users during testing)

**Impact**: Critical - Defeats purpose of ground truth logging

**Root Causes**:
- Race conditions in database writes
- Network latency causing delayed submissions
- Client-side optimistic UI showing success before server confirms

**Mitigation**:
- PostgreSQL ACID transactions ensure atomicity
- Use connection pooling (10-20 connections) to handle burst traffic
- Server-side timestamp generation (not client-side) for accuracy
- Each request gets unique ID immediately from database sequence
- Optimistic UI with rollback on error

**Derisking**:
- ✅ Phase 1: Add database transaction tests with concurrent inserts
- ✅ Phase 1: Load test with 10 simultaneous POST requests
- ✅ Phase 4: Real-world testing with multiple devices clicking same button

**Status**: Mitigated by architecture

---

### 2. Mobile Touch Event Compatibility
**Risk**: Touch interactions behave differently on iOS vs Android vs browsers

**Likelihood**: High (different devices have different touch APIs)

**Impact**: High - Users can't record events, undo doesn't work

**Specific Issues**:
- iOS Safari: Different touchstart/touchend behavior
- Android Chrome: Touch event propagation differences
- Long-press triggering context menus on mobile
- Double-tap zoom interfering with rapid clicks
- Accidental touch during scrolling

**Mitigation**:
- Use standard touch events (touchstart, touchend, touchmove)
- `preventDefault()` on touch events to stop default behaviors
- Disable user-select and touch-callout CSS properties
- Add `touch-action: manipulation` to prevent zoom delays
- Test long-press with `touchstart` + `touchend` timing (not mouse events)

**Derisking**:
- ✅ Phase 2: Test on physical iPhone (Safari)
- ✅ Phase 2: Test on physical Android device (Chrome)
- ✅ Phase 2: Test on iPad
- ✅ Phase 4: User acceptance testing with actual field testers

**Status**: Requires real device testing

---

### 3. Network Latency on Mobile Cellular
**Risk**: Slow 3G/4G connections cause long delays between click and server confirmation

**Likelihood**: Medium (depends on testing location)

**Impact**: Medium - User confusion, possible duplicate clicks

**Scenarios**:
- User clicks button, sees green flash, but event fails to save due to timeout
- User thinks event didn't record, clicks again (duplicate)
- Undo attempt fails silently due to network error
- Recent events log shows stale data

**Mitigation**:
- Optimistic UI updates (instant green flash before server confirms)
- Show loading spinner if request takes > 1 second
- Display error toast if request fails (allow retry)
- Implement request timeout (5 seconds max)
- Add retry logic with exponential backoff

**Derisking**:
- ✅ Phase 3: Test with Chrome DevTools network throttling (Slow 3G)
- ✅ Phase 3: Add error states and retry UX
- ✅ Phase 4: Field test on actual cellular network

**Status**: Needs error handling implementation

---

### 4. Accidental Undo (Long-Press Triggered Unintentionally)
**Risk**: User accidentally holds button while scrolling or adjusting grip

**Likelihood**: Medium (mobile users frequently touch-and-drag)

**Impact**: Low-Medium - Deletes valid ground truth data

**Scenarios**:
- User scrolls past button, holds for 2+ seconds
- User rests thumb on button while reading
- User tries to zoom/pan and triggers long-press

**Mitigation**:
- 2-second threshold provides safety margin (typical scroll is < 1s)
- Visual progress indicator shows countdown (user can release early)
- Undo only affects most recent event for that specific button (not global)
- Detect touchmove and cancel undo if finger moves > 10px
- Add haptic feedback on undo completion (vibration alert)

**Derisking**:
- ✅ Phase 2: Implement touchmove cancellation
- ✅ Phase 2: User testing to validate 2s threshold is appropriate
- ✅ Consider: Add confirmation dialog for undo (may slow down workflow)

**Status**: Low risk with proper implementation

---

### 5. Data Loss During Railway Deployment
**Risk**: Database restarts during Railway deployment, losing in-flight transactions

**Likelihood**: Low (Railway has zero-downtime deploys for database)

**Impact**: Low - Only affects events recorded during ~30s deploy window

**Scenarios**:
- User clicks button during deployment
- Request times out or returns 500 error
- Event not saved to database

**Mitigation**:
- Railway PostgreSQL service remains available during app deployments
- Connection pool handles reconnection automatically
- Client-side retry on 500/503 errors
- Deploy during low-usage periods (not during active testing)

**Derisking**:
- ✅ Phase 4: Test deployment during active usage
- ✅ Add monitoring/logging to detect lost requests

**Status**: Accept risk (low impact for testing tool)

---

### 6. Clock Skew Between Devices
**Risk**: Client devices have incorrect system clocks, causing timestamp inconsistencies

**Likelihood**: Medium (mobile devices may have auto-sync disabled)

**Impact**: High - Ground truth timestamps don't match counter system timestamps

**Scenarios**:
- User's phone clock is 5 minutes fast
- Events recorded with future timestamps
- Comparison with sensor data shows incorrect time deltas

**Mitigation**:
- **Use server-side timestamp generation only** (ignore client time)
- Server timestamp recorded as `NOW() AT TIME ZONE 'UTC'` in PostgreSQL
- Client never sends timestamp, only door_number + event_type
- All timestamps guaranteed to be accurate server time

**Derisking**:
- ✅ Phase 1: Verify all timestamps come from server, not client
- ✅ Phase 1: Add validation that client cannot override timestamp

**Status**: Fully mitigated by architecture

---

## Medium Priority Risks

### 7. 7-Day Data Retention Job Failure
**Risk**: Cron job fails to delete old data, database grows indefinitely

**Likelihood**: Low (cron jobs are reliable)

**Impact**: Medium - Railway database fills up, hits storage limits

**Mitigation**:
- Add logging for cleanup job (record deleted count)
- Monitor database size via Railway dashboard
- Add alert if cleanup hasn't run in > 24 hours
- Manual cleanup query available in documentation

**Derisking**:
- ✅ Phase 3: Test cleanup job manually
- ✅ Phase 4: Monitor for 1 week to ensure daily execution

---

### 8. CSV Export Memory Overflow
**Risk**: Exporting large datasets (70K+ rows) causes server memory issues

**Likelihood**: Low (7-day window limits data size)

**Impact**: Low - Export fails or server crashes

**Mitigation**:
- Use streaming CSV generation (not loading all rows into memory)
- PostgreSQL cursors for large result sets
- Limit export to 7-day retention window (max ~70K rows)
- Add loading indicator for large exports

**Derisking**:
- ✅ Phase 3: Test export with 100K+ mock rows

---

### 9. Undo Logic - Wrong Event Deleted
**Risk**: Undo deletes incorrect event (not the most recent for that button)

**Likelihood**: Low (if logic is correct)

**Impact**: High - Corrupts ground truth data

**Scenarios**:
- User clicks Door 5 A_IN twice rapidly
- User tries to undo second click
- First click gets deleted instead

**Mitigation**:
- Undo query: `DELETE WHERE door_number = X AND event_type = Y AND deleted_at IS NULL ORDER BY timestamp_utc DESC LIMIT 1`
- Store event ID client-side after each click
- Undo sends specific event ID to delete (not just door + type)

**Derisking**:
- ✅ Phase 2: Write unit tests for undo logic
- ✅ Phase 2: Manual testing with rapid clicks + undo

---

## Low Priority Risks

### 10. Mobile Browser Compatibility (Older Devices)
**Risk**: App doesn't work on older iOS/Android versions

**Likelihood**: Low (most testers have recent devices)

**Impact**: Low - Some users can't participate in testing

**Mitigation**:
- Use vanilla JavaScript (no ES2020+ features requiring transpilation)
- Test on iOS 14+ and Android 9+
- Provide desktop fallback option

---

## Risk Prioritization for Development

**Phase 1 - Must Address**:
1. ✅ Clock Skew (server-side timestamps)
2. ✅ Concurrent Clicks (database transactions)
3. ✅ SQL Injection (parameterized queries)

**Phase 2 - Test & Validate**:
4. ✅ Mobile Touch Events (real device testing)
5. ✅ Undo Logic (unit tests + manual testing)
6. ✅ Accidental Undo (touchmove cancellation)

**Phase 3 - Monitor & Handle**:
7. ✅ Network Latency (error handling + retry)
8. ✅ 7-Day Cleanup (logging + monitoring)

**Phase 4 - Accept or Monitor**:
9. ✅ Railway Deployment (low impact, accept risk)
10. ✅ CSV Export Memory (streaming export)

---

## Continuous Risk Monitoring

- Track actual click patterns during testing (concurrent users, click rate)
- Monitor Railway database metrics (size, connection count)
- Log all errors (API failures, database errors, client-side errors)
- User feedback on mobile UX issues
