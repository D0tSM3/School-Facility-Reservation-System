-- Add Other to the PostgreSQL enum used by Reservations.category.
DO $$
DECLARE
    category_type regtype;
BEGIN
    SELECT a.atttypid::regtype
      INTO category_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema()
       AND c.relname = 'reservations'
       AND a.attname = 'category'
       AND NOT a.attisdropped;

    IF category_type IS NULL THEN
        RAISE EXCEPTION 'Reservations.category was not found in the current schema';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM pg_type t
         WHERE t.oid = category_type
           AND t.typtype = 'e'
    ) THEN
        RAISE EXCEPTION 'Reservations.category must be a PostgreSQL enum';
    END IF;

    EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L', category_type, 'Other');
END;
$$;
