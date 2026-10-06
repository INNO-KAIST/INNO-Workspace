-- H9-3: the workspace revision at which each task last changed, so a page can ask only
-- for tasks changed since the revision it holds. Rows written before this keep 0 and are
-- part of every full read.
ALTER TABLE tasks ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS tasks_rev ON tasks(rev);
