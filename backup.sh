#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp db.json "db_backup_$DATE.json"
echo "✅ Backup tersimpan: db_backup_$DATE.json"
