Push the monastery donation page to main so it goes live.

The file `rahulio/pages/donate.html` exists on branch `claude/monastery-donation-payments-r5onx`. Merge it into main and push.

```bash
git fetch origin claude/monastery-donation-payments-r5onx
git checkout main
git pull origin main
git merge origin/claude/monastery-donation-payments-r5onx --no-edit
git push origin main
```

Expected result: https://alpacaplayhouse.com/rahulio/pages/donate.html goes live.
