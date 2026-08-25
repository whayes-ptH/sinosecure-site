CREATE TABLE underwriting_clients (
  id serial PRIMARY KEY,
  name text NOT NULL,
  contact_name text,
  contact_email text CONSTRAINT underwriting_clients_contact_email_unique UNIQUE,
  status text DEFAULT 'active' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE underwriting_projects ADD COLUMN client_id integer;
ALTER TABLE underwriting_projects ADD COLUMN project_name text;

-- Existing matters with the same normalized contact email become projects under
-- one client. The earliest matter supplies the initial client display details.
INSERT INTO underwriting_clients (name, contact_name, contact_email, created_at, updated_at)
SELECT DISTINCT ON (lower(trim(contact_email)))
  COALESCE(NULLIF(trim(organisation), ''), NULLIF(trim(contact_name), ''), lower(trim(contact_email))),
  NULLIF(trim(contact_name), ''),
  lower(trim(contact_email)),
  created_at,
  updated_at
FROM underwriting_projects
WHERE contact_email IS NOT NULL AND trim(contact_email) <> ''
ORDER BY lower(trim(contact_email)), created_at ASC, id ASC;

UPDATE underwriting_projects AS project
SET client_id = client.id
FROM underwriting_clients AS client
WHERE project.contact_email IS NOT NULL
  AND lower(trim(project.contact_email)) = client.contact_email;

-- Defensive legacy path for a project opened without an email under the old API.
INSERT INTO underwriting_clients (name, contact_name, contact_email, created_at, updated_at)
SELECT
  'Legacy client — ' || reference,
  contact_name,
  NULL,
  created_at,
  updated_at
FROM underwriting_projects
WHERE client_id IS NULL;

UPDATE underwriting_projects AS project
SET client_id = client.id
FROM underwriting_clients AS client
WHERE project.client_id IS NULL
  AND client.name = 'Legacy client — ' || project.reference;

UPDATE underwriting_projects
SET project_name = COALESCE(
  NULLIF(trim(coverage_interest), '') || ' — ' || reference,
  'Underwriting project — ' || reference
);

-- Netlify applies migrations immediately before publishing the new application.
-- This trigger keeps the previous application version compatible during that brief
-- handover window if it opens a project without the two new columns.
CREATE OR REPLACE FUNCTION ensure_underwriting_project_client()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.client_id IS NULL THEN
    IF NEW.contact_email IS NOT NULL AND trim(NEW.contact_email) <> '' THEN
      SELECT id INTO NEW.client_id
      FROM underwriting_clients
      WHERE contact_email = lower(trim(NEW.contact_email))
      LIMIT 1;
    END IF;

    IF NEW.client_id IS NULL THEN
      INSERT INTO underwriting_clients (name, contact_name, contact_email)
      VALUES (
        COALESCE(NULLIF(trim(NEW.organisation), ''), NULLIF(trim(NEW.contact_name), ''), 'Client — ' || NEW.reference),
        NULLIF(trim(NEW.contact_name), ''),
        CASE WHEN NEW.contact_email IS NULL THEN NULL ELSE lower(trim(NEW.contact_email)) END
      )
      RETURNING id INTO NEW.client_id;
    END IF;
  END IF;

  IF NEW.project_name IS NULL OR trim(NEW.project_name) = '' THEN
    NEW.project_name := COALESCE(
      NULLIF(trim(NEW.coverage_interest), '') || ' — ' || NEW.reference,
      'Underwriting project — ' || NEW.reference
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER underwriting_projects_ensure_client
BEFORE INSERT ON underwriting_projects
FOR EACH ROW EXECUTE FUNCTION ensure_underwriting_project_client();

ALTER TABLE underwriting_projects ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE underwriting_projects ALTER COLUMN project_name SET NOT NULL;

CREATE INDEX underwriting_projects_client_idx
  ON underwriting_projects (client_id);

ALTER TABLE underwriting_projects
  ADD CONSTRAINT underwriting_projects_client_id_underwriting_clients_id_fkey
  FOREIGN KEY (client_id) REFERENCES underwriting_clients(id);
