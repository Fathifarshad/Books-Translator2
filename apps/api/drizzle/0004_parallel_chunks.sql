-- ADR-038: translate chunks no longer wait for the previous chunk of the same chapter. A book whose text is one
-- long chapter could otherwise only ever run a single chunk at a time. Unchain the chunks already in the queue,
-- so books that are half-translated get the same parallelism without being restarted.
UPDATE jobs SET depends_on = NULL
 WHERE stage = 'translate'
   AND depends_on IS NOT NULL
   AND status IN ('queued', 'awaiting_agent', 'running');
