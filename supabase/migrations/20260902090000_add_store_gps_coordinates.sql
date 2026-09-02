ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS gps_latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS gps_longitude numeric(11, 7);

ALTER TABLE public.stores
  DROP CONSTRAINT IF EXISTS stores_gps_latitude_range,
  DROP CONSTRAINT IF EXISTS stores_gps_longitude_range,
  ADD CONSTRAINT stores_gps_latitude_range
    CHECK (gps_latitude IS NULL OR (gps_latitude >= -90 AND gps_latitude <= 90)),
  ADD CONSTRAINT stores_gps_longitude_range
    CHECK (gps_longitude IS NULL OR (gps_longitude >= -180 AND gps_longitude <= 180));

CREATE INDEX IF NOT EXISTS idx_stores_gps_coordinates
  ON public.stores(gps_latitude, gps_longitude)
  WHERE gps_latitude IS NOT NULL AND gps_longitude IS NOT NULL;

COMMENT ON COLUMN public.stores.gps_latitude IS '門市 Google 地圖 GPS 緯度';
COMMENT ON COLUMN public.stores.gps_longitude IS '門市 Google 地圖 GPS 經度';

NOTIFY pgrst, 'reload schema';
