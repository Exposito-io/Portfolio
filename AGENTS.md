# Repository rules

- Persist dates and timestamps in databases as native date values (for MongoDB, BSON `Date`/`ISODate`), never as strings. String date formats are allowed only at API, form, display, and other serialization boundaries.
