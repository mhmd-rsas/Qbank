# CourseWise site (formerly "LAU QBank")

Static study website (summaries, flashcards and exam-style questions per lecture) (plain HTML, CSS and JavaScript; no build step is needed to host it, no trackers, no outside requests).
Live at https://mhmd-rsas.github.io/Qbank/ once this folder is pushed with GitHub Desktop.

## What is in this folder

| File | Purpose |
|---|---|
| `index.html`, `app.js`, `style.css`, `theme.js` | the whole app (one page; addresses look like `#/m/hematology-immunology/immunology/innate-immunity`) |
| `data/registry.json` | list of lecture files, one per line, plus the build version/date and the name of the bundle |
| `data/all.json` | every lecture in one file (made by the build; the site downloads this instead of 80+ small files) |
| `data/<module>/<discipline>/<lecture>.json` | one lecture: title, covers line, summary, flashcards, questions |
| `data/images/` | slide figures used in summaries and flashcards |
| `sw.js` | makes the site work offline after the first visit |
| `manifest.webmanifest`, `favicon.svg`, `icon-*.png` | icon and "add to home screen" |
| `404.html`, `404.js` | page shown for a wrong address |
| `.nojekyll` | tells GitHub Pages to serve the files as they are |

## Adding or extending a lecture

One file per lecture in `data/<module>/<discipline>/<lecture-title>.json`, plus one line in `data/registry.json`.
Lectures are shown by topic title only (no lecture numbers); the order inside a discipline is the order of the lines in the registry.

**Normal way (recommended):** work in `~/Desktop/claude/Medschool` and let the build make the files:

- questions: `output/qbank/<Module>/<Discipline>/<stem>.json` (QBank format, see `.claude/skills/lecture/qbank.md`)
- summary + flashcards: `output/study/<Module>/<Discipline>/<stem>.json` (written by `tools/study_compile.py` from a draft)
- then `python3 -I tools/build_site_v2.py --deploy`, and commit + push in GitHub Desktop.

The build checks the questions, strips lecture numbers from titles, copies slide figures to `data/images/` and refreshes the offline version stamp.

**By hand (three steps, only if the build cannot be used):** drop a lecture file in `data/...`, add its path as one line in the `lectures` list of `data/registry.json`, and delete the `"bundle": "data/all.json",` line from the registry so the site reads the single lecture files again (the next build puts the bundle back).

```json
{"module": "Hematology", "discipline": "Immunology", "title": "Innate immunity",
 "covers": "One line saying what the lecture is about.",
 "summary": [{"h": "Heading", "items": [{"p": "Paragraph", "source": "slides"}, {"ul": ["Bullet"], "source": "slides"},
              {"table": [["Head A", "Head B"], ["a", "b"]], "source": "slides"}, {"note": "Flagged note", "source": "original"},
              {"img": "data/images/figure.jpg", "caption": "Caption", "source": "slides"}]}],
 "cards": [{"id": "a1b2c3d4", "q": "Front", "a": "Back", "x": "Optional extra line", "source": "slides"}],
 "questions": [{"id": "HEM-IMM-L01-01", "style": "LAU", "stem": "Question text",
                "options": {"A": "...", "B": "...", "C": "...", "D": "...", "E": "..."}, "answer": "C",
                "explanation": "Why C is right. A: why not. B: why not. D: why not. E: why not.", "source": "Slide 12"}]}
```

`source` on summary blocks, cards and images records where the content came from ("slides", "anking", "original", or another
resource). The site never shows it; it exists so a later version can filter content by origin.
Question ids and card ids must stay unique and stable: saved progress is stored per id.

## Progress

Answers, flags, flashcard marks and session history are stored in the browser (localStorage) on the device used. Settings → Export progress
makes a backup file; Import restores or merges it on another device.

## Testing on the Mac

```
cd ~/Desktop/claude/Medschool/output/site-v2 && python3 -m http.server 8811
```
then open http://localhost:8811/ (if the page looks old, another server is already using that port: pick another number) (do not use port 8765; that is AnkiConnect). Opening `index.html` by double-click does not work, because browsers block data loading from `file://`.
