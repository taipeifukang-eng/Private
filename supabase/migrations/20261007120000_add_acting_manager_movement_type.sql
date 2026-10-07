-- Treat acting-manager appointments as their own employee movement type.
ALTER TABLE public.employee_movement_history
DROP CONSTRAINT IF EXISTS valid_movement_type;

ALTER TABLE public.employee_movement_history
ADD CONSTRAINT valid_movement_type
CHECK (movement_type IN (
  'onboarding',
  'promotion',
  'acting_manager',
  'leave_without_pay',
  'return_to_work',
  'pass_probation',
  'resignation',
  'store_transfer'
));

COMMENT ON COLUMN public.employee_movement_history.movement_type IS
  '異動類型: onboarding(入職), promotion(升職), acting_manager(代理), store_transfer(調店), leave_without_pay(留職停薪), return_to_work(復職), pass_probation(過試用期), resignation(離職)';
