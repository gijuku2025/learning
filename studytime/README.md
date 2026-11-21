# Kanji SRS

A tiny Anki-style spaced repetition app for studying Japanese vocabulary/kanji. Runs entirely in the browser, hosted free on GitHub Pages. No server, no build step.

## Features
- **Learn 5 new** – shows 5 new words with reading, meaning, part of speech and example sentence, then a quick check. Reviews unlock once words are learned.
- **Reviews** – Anki-style scheduling (Again / Hard / Good / Easy, SM-2 style ease and intervals). Missed cards repeat until you get them.
- **Free study** – flip through *every word you've learned so far*, with example sentences. It never changes your schedule or counts as a review.
- One JSON deck per spreadsheet; pick a deck or study all of them together.
- 🔊 audio for words and sentences (browser text-to-speech, ja-JP).
- Export / import progress as a JSON backup.
- Keyboard: Space = show answer / Good, 1–4 = rate, ← → in study mode.

## Deploy on GitHub
1. Create a repo and push this folder.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<you>.github.io/<repo>/`.

## Adding spreadsheets
1. Drop `.xlsx` files into `source/` (same columns as your first file; Vietnamese columns are ignored).
2. Run `pip install openpyxl` then `python scripts/convert.py`.
3. Commit the updated `data/` folder. Each spreadsheet becomes its own `data/<name>.json`, and `data/manifest.json` is rebuilt.

## Testing locally
Browsers block `fetch` from `file://`, so run `python -m http.server` in this folder and open http://localhost:8000.

## Note on progress
Progress is stored in your browser's localStorage (per device/browser). Use **Export** to back up or move to another device. A GitHub repo is static, so it can't store progress itself.
