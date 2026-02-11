# Extracting contacts from lease documents

Use `extract-contacts-from-leases.js` to pull **phone numbers** and **emails** from legacy lease PDFs (e.g. on Google Drive) so you can fill missing `people.phone` / `people.email` (e.g. Ai Ko’s email, resident phones).

## Option 1: Local PDFs (e.g. downloaded from Drive)

1. Download the lease PDFs from the [legacy Drive folder](https://drive.google.com/drive/folders/1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ) into a folder (e.g. `./lease-pdfs`).
2. Install deps and run:

```bash
cd scripts
npm install
node extract-contacts-from-leases.js /path/to/lease-pdfs
```

3. Inspect the JSON output: `byFile` (per-file emails/phones) and `suggestedUpdates` (per person, inferred from filenames like `Ai Ko - Lease.pdf`).
4. To print SQL `UPDATE people SET ...` statements (match by first/last name):

```bash
node extract-contacts-from-leases.js /path/to/lease-pdfs --sql
```

Then run those statements in Supabase SQL Editor (or pipe into `psql $SUPABASE_DB_URL`).

## Option 2: Google Drive API

1. In [Google Cloud Console](https://console.cloud.google.com/) create a service account and download its JSON key.
2. Share the Drive folder **with that service account email** (e.g. `xxx@yyy.iam.gserviceaccount.com`) as Viewer.
3. Enable the **Google Drive API** for the project.
4. Run:

```bash
cd scripts
npm install
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export DRIVE_FOLDER_ID=1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ   # optional; this is the default
node extract-contacts-from-leases.js --drive
```

Use `--sql` as above to emit UPDATEs for `people`.

## Matching people

- Person is inferred from the **filename** (e.g. `Ai Ko - Lease.pdf` → first name `Ai`, last name `Ko`).
- All emails and phone numbers found in that file are attributed to that person; `suggestedUpdates` picks one email and one phone per person.
- `--sql` generates `UPDATE people SET email = ..., phone = ... WHERE` matching on `LOWER(TRIM(first_name))` and `LOWER(TRIM(last_name))`. Review before running.
