-- Add planning requirements to event requests.
-- Run once in the Supabase SQL editor; safe to re-run.
-- Impact: additive only; existing event rows are not rewritten.
-- Rollback: dropping these columns would permanently remove submitted planning details.

alter table "Event Details"
  add column if not exists layout_required text,
  add column if not exists equipment_required text[] not null default '{}',
  add column if not exists accessibility_required smallint not null default 0,
  add column if not exists equipment_placement text,
  add column if not exists crowd_movement text,
  add column if not exists facilities_required text[] not null default '{}';
