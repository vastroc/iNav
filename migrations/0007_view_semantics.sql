-- Site views now mean outbound website jumps; standalone pages get their own visit counter.
UPDATE sites SET views = clicks;
ALTER TABLE pages ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
