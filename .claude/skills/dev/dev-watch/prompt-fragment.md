# Dev-Watch Error Feedback Protocol

If `.claude-project/status/DEV_WATCH_ACTIVE.md` exists, dev servers are running with hot-reload.

## After EACH File You Create or Modify

1. **Check server logs for errors:**

   ```bash
   pm2 logs --lines 30 --nostream 2>/dev/null | tail -30
   ```

   If PM2 is not available, check log files:

   ```bash
   tail -30 /tmp/dev-watch-backend.log 2>/dev/null
   tail -30 /tmp/dev-watch-frontend.log 2>/dev/null
   ```

2. **Check server process status:**

   ```bash
   pm2 jlist 2>/dev/null | node -e "
     let d='';
     process.stdin.on('data', c => d += c);
     process.stdin.on('end', () => {
       try {
         JSON.parse(d).forEach(p => console.log(p.name + ': ' + p.pm2_env.status));
       } catch(e) {}
     });
   "
   ```

3. **If ANY of these patterns appear in logs:**
   - `ERROR`, `Error:`, `error TS`
   - `TypeError`, `ReferenceError`, `SyntaxError`
   - `Cannot find module`, `Module not found`
   - `Failed to compile`, `Build failed`, `compilation failed`
   - `Cannot read properties of`
   - `is not a function`, `is not defined`

   **Then: FIX THE ERROR NOW** before writing the next file.
   **Then: Re-run the log check** to confirm the error is resolved.

4. **If server crashed** (status shows `errored` or `stopped`):
   ```bash
   pm2 restart {process-name}
   ```
   Wait 3 seconds, then re-check logs.

## Rules

- **One file at a time** — write, verify, move on. Do not batch multiple files and check later.
- **Do not ignore warnings that are actually errors** — `error TS` lines are TypeScript compilation failures, not warnings.
- **If the same error persists after 2 fix attempts** — stop and investigate the root cause rather than making incremental guesses.
- **Log checks are fast** — `--nostream` dumps last 30 lines and exits instantly. This adds seconds, not minutes.
