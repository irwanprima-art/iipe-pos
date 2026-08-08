-- 0009_merge_roles.sql
-- Gabungkan role picker & packer menjadi operator.
UPDATE users SET role = 'operator' WHERE role IN ('picker', 'packer');
