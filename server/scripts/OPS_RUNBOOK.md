# OPS Runbook: Capacity + Full Backup

## 1) Capacity test ("how many users")

Run on VPS (from `server/`):

```bash
cd /opt/farm-server/server
node scripts/capacity-test.mjs
```

Recommended stricter run:

```bash
cd /opt/farm-server/server
CAP_BASE_URL="http://127.0.0.1:3000" \
CAP_USERNAME="admin" \
CAP_PASSWORD="YOUR_ADMIN_PASSWORD" \
CAP_STEPS="20,40,60,80,100,140,180" \
CAP_STEP_DURATION_SEC=90 \
CAP_P95_LIMIT_MS=1200 \
CAP_ERROR_RATE_LIMIT=0.02 \
node scripts/capacity-test.mjs
```

Result JSON is saved to:

```text
server/scripts/reports/capacity-*.json
```

Interpretation:
- `maxStableConcurrentUsers` = max step where both conditions passed:
  - `p95 <= CAP_P95_LIMIT_MS`
  - `errorRate <= CAP_ERROR_RATE_LIMIT`

---

## 2) Full backup before defense

Run on VPS (from project root `/opt/farm-server`):

```bash
cd /opt/farm-server
chmod +x server/scripts/vps-full-backup.sh
./server/scripts/vps-full-backup.sh
```

Expected output:
- archive: `/opt/backups/farm-site/farm-site-full_YYYYMMDD_HHMMSS.tar.gz`
- checksum: `...tar.gz.sha256`
- manifest: `...manifest.txt`

Verify backup:

```bash
chmod +x server/scripts/vps-verify-backup.sh
./server/scripts/vps-verify-backup.sh /opt/backups/farm-site/farm-site-full_YYYYMMDD_HHMMSS.tar.gz
```

---

## 3) Restore (rollback everything)

```bash
cd /opt/farm-server
chmod +x server/scripts/vps-restore-backup.sh
./server/scripts/vps-restore-backup.sh /opt/backups/farm-site/farm-site-full_YYYYMMDD_HHMMSS.tar.gz
```

After restore check:

```bash
pm2 list
curl -fsS http://127.0.0.1:3000/api/health
```

If health is `ok`, rollback succeeded.
