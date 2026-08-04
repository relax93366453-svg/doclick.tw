DOCLOCK NO-NODE FIX

This version does not require Node.js.

Copy these files into the same doclick.tw folder as index.html:
- server.ps1
- START_DOCLOCK_NO_NODE.bat
- RESET_TOKEN.bat

Start the system:
1. Double-click START_DOCLOCK_NO_NODE.bat
2. On first run, paste only the characters after JOB_ADMIN_TOKEN=
3. Keep the black/blue PowerShell window open
4. The browser opens http://127.0.0.1:8765/index.html

If the token changes:
1. Close the server window
2. Double-click RESET_TOKEN.bat
3. Start again and paste the new token
