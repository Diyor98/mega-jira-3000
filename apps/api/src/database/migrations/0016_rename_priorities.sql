-- Rename issue_priority enum values from P1/P2/P3/P4 to critical/high/medium/low
ALTER TYPE issue_priority RENAME VALUE 'P1' TO 'critical';
ALTER TYPE issue_priority RENAME VALUE 'P2' TO 'high';
ALTER TYPE issue_priority RENAME VALUE 'P3' TO 'medium';
ALTER TYPE issue_priority RENAME VALUE 'P4' TO 'low';

-- Update the column default
ALTER TABLE issues ALTER COLUMN priority SET DEFAULT 'medium';
