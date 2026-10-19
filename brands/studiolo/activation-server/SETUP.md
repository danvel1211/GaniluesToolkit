# Setting up code activation (one time, about 10 minutes)

This makes a licence code usable **once**. When someone activates a code and its **Name** cell is empty, their name is written there. If the Name cell already has any name (even the same one), the app says the code is already used.

Your Google Sheet stays **private**. The app never contains the sheet's link; it only talks to a small script that answers "ok / used / invalid".

## 1. Make the codes sheet
1. In Google Drive, open **Studiolo licence codes - batch B1.xlsx** and choose **Open with → Google Sheets**, then **File → Save as Google Sheets**.
2. Row 1 must be headings. Column **A = Code**, **B = Name**, **C = Activated**. Leave B and C empty; the script fills them in.
3. Keep this sheet private (don't share it, and don't put it in a folder shared by link).

## 2. Add the script
1. Go to <https://script.google.com> → **New project**. Name it "Studiolo activation".
2. Delete the sample code and paste in everything from `Code.gs` (this folder).
3. In `setSheetId`, replace `PASTE-YOUR-SHEET-ID-HERE` with the sheet's ID (the long part of its address between `/d/` and `/edit`, keep the quotes). Save, select `setSheetId` and click **Run**; allow the permissions Google asks for. Then delete the ID from the code and save again.

## 3. Publish it
1. **Deploy → New deployment → Web app.**
2. *Execute as:* **Me**. *Who has access:* **Anyone**. (The script only ever answers ok / used / invalid; it never shows the sheet.)
3. Click **Deploy** and copy the **Web app URL** (starts with `https://script.google.com/macros/s/`).

## 4. Give the app the address
Create the file `brands/studiolo/activation.json` (it is git-ignored, so it never goes into the repository):

```json
{ "url": "https://script.google.com/macros/s/XXXXXXXX/exec" }
```

Then rebuild: `python3 tools/build_exe.py`.

## Notes
- Activation needs the internet **once**. After that the licence is remembered and Studiolo works offline.
- The developer code never contacts the server.
- A customer who reinstalls, switches computers or clears the app's saved data will be told the code is used. To let them in again, clear that row's **Name** and **Activated** cells; they can then activate once more.
- If you change the script, use **Deploy → Manage deployments → Edit → New version** so the address stays the same.
