DROP TABLE IF EXISTS public.ga_purchase_review_quotes;
DROP TABLE IF EXISTS public.ga_purchase_reviews;
DROP FUNCTION IF EXISTS public.ga_touch_purchase_review_updated_at();

DELETE FROM public.role_permissions
WHERE permission_id IN (
  SELECT id FROM public.permissions
  WHERE code IN (
    'general_affairs.purchase_review.view',
    'general_affairs.purchase_review.manage'
  )
);

DELETE FROM public.permissions
WHERE code IN (
  'general_affairs.purchase_review.view',
  'general_affairs.purchase_review.manage'
);

NOTIFY pgrst, 'reload schema';
