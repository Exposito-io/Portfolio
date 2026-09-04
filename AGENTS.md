# Repository rules

- Persist dates and timestamps in databases as native date values (for MongoDB, BSON `Date`/`ISODate`), never as strings. String date formats are allowed only at API, form, display, and other serialization boundaries.
- For frontend QA, prefer claiming the existing authenticated `localhost:3000` tab in the Codex in-app Browser before opening a new tab. The user keeps the local Portfolio app signed in there; explicitly use `@Browser` or the attached Portfolio tab so the authenticated session and rendered state are available for inspection.
