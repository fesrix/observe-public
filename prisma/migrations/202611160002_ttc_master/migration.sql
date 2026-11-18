-- Add a read-only staff role. Existing users keep their current roles.
ALTER TYPE "Role" ADD VALUE 'TTC_MASTER';
