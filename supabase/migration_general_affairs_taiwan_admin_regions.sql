-- ============================================================
-- 總務服務中心 - 台灣縣市與行政區服務區域
-- 說明：
--   補齊大區 > 縣市 > 行政區階層，供廠商服務範圍精準選擇。
-- ============================================================

INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
VALUES
  ('離島地區', 'TW-O', NULL, 'region', '離島主要服務區域', ARRAY['澎湖縣', '金門縣', '連江縣'], 6)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_id = NULL,
  region_type = EXCLUDED.region_type,
  description = EXCLUDED.description,
  included_locations = EXCLUDED.included_locations,
  sort_order = EXCLUDED.sort_order,
  status = 'active',
  updated_at = NOW();

WITH city_seed(name, code, parent_code, sort_order) AS (
  VALUES
    ('基隆市', 'KEE', 'TW-N', 1),
    ('台北市', 'TPE', 'TW-N', 2),
    ('新北市', 'TPH', 'TW-N', 3),
    ('桃園市', 'TYC', 'TW-N', 4),
    ('新竹市', 'HSZ', 'TW-N', 5),
    ('新竹縣', 'HSQ', 'TW-N', 6),
    ('宜蘭縣', 'ILA', 'TW-N', 7),
    ('苗栗縣', 'MIA', 'TW-C', 1),
    ('台中市', 'TXG', 'TW-C', 2),
    ('彰化縣', 'CHA', 'TW-C', 3),
    ('南投縣', 'NAN', 'TW-C', 4),
    ('雲林縣', 'YUN', 'TW-C', 5),
    ('嘉義市', 'CYI', 'TW-S', 1),
    ('嘉義縣', 'CYQ', 'TW-S', 2),
    ('台南市', 'TNN', 'TW-S', 3),
    ('高雄市', 'KHH', 'TW-S', 4),
    ('屏東縣', 'PIF', 'TW-S', 5),
    ('花蓮縣', 'HUA', 'TW-E', 1),
    ('台東縣', 'TTT', 'TW-E', 2),
    ('澎湖縣', 'PEN', 'TW-O', 1),
    ('金門縣', 'KIN', 'TW-O', 2),
    ('連江縣', 'LIE', 'TW-O', 3)
)
INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
SELECT
  city_seed.name,
  city_seed.code,
  parent.id,
  'city',
  city_seed.name || '全區',
  ARRAY[city_seed.name],
  city_seed.sort_order
FROM city_seed
JOIN ga_service_regions parent ON parent.code = city_seed.parent_code
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_id = EXCLUDED.parent_id,
  region_type = EXCLUDED.region_type,
  description = EXCLUDED.description,
  included_locations = EXCLUDED.included_locations,
  sort_order = EXCLUDED.sort_order,
  status = 'active',
  updated_at = NOW();

WITH district_seed(city_code, names) AS (
  VALUES
    ('KEE', ARRAY['仁愛區','信義區','中正區','中山區','安樂區','暖暖區','七堵區']),
    ('TPE', ARRAY['中正區','大同區','中山區','松山區','大安區','萬華區','信義區','士林區','北投區','內湖區','南港區','文山區']),
    ('TPH', ARRAY['板橋區','三重區','中和區','永和區','新莊區','新店區','土城區','蘆洲區','樹林區','汐止區','鶯歌區','三峽區','淡水區','瑞芳區','五股區','泰山區','林口區','深坑區','石碇區','坪林區','三芝區','石門區','八里區','平溪區','雙溪區','貢寮區','金山區','萬里區','烏來區']),
    ('TYC', ARRAY['桃園區','中壢區','平鎮區','八德區','楊梅區','蘆竹區','大溪區','龍潭區','龜山區','大園區','觀音區','新屋區','復興區']),
    ('HSZ', ARRAY['東區','北區','香山區']),
    ('HSQ', ARRAY['竹北市','竹東鎮','新埔鎮','關西鎮','湖口鄉','新豐鄉','芎林鄉','橫山鄉','北埔鄉','寶山鄉','峨眉鄉','尖石鄉','五峰鄉']),
    ('ILA', ARRAY['宜蘭市','羅東鎮','蘇澳鎮','頭城鎮','礁溪鄉','壯圍鄉','員山鄉','冬山鄉','五結鄉','三星鄉','大同鄉','南澳鄉']),
    ('MIA', ARRAY['苗栗市','苑裡鎮','通霄鎮','竹南鎮','頭份市','後龍鎮','卓蘭鎮','大湖鄉','公館鄉','銅鑼鄉','南庄鄉','頭屋鄉','三義鄉','西湖鄉','造橋鄉','三灣鄉','獅潭鄉','泰安鄉']),
    ('TXG', ARRAY['中區','東區','南區','西區','北區','西屯區','南屯區','北屯區','豐原區','東勢區','大甲區','清水區','沙鹿區','梧棲區','后里區','神岡區','潭子區','大雅區','新社區','石岡區','外埔區','大安區','烏日區','大肚區','龍井區','霧峰區','太平區','大里區','和平區']),
    ('CHA', ARRAY['彰化市','鹿港鎮','和美鎮','線西鄉','伸港鄉','福興鄉','秀水鄉','花壇鄉','芬園鄉','員林市','溪湖鎮','田中鎮','大村鄉','埔鹽鄉','埔心鄉','永靖鄉','社頭鄉','二水鄉','北斗鎮','二林鎮','田尾鄉','埤頭鄉','芳苑鄉','大城鄉','竹塘鄉','溪州鄉']),
    ('NAN', ARRAY['南投市','埔里鎮','草屯鎮','竹山鎮','集集鎮','名間鄉','鹿谷鄉','中寮鄉','魚池鄉','國姓鄉','水里鄉','信義鄉','仁愛鄉']),
    ('YUN', ARRAY['斗六市','斗南鎮','虎尾鎮','西螺鎮','土庫鎮','北港鎮','古坑鄉','大埤鄉','莿桐鄉','林內鄉','二崙鄉','崙背鄉','麥寮鄉','東勢鄉','褒忠鄉','臺西鄉','元長鄉','四湖鄉','口湖鄉','水林鄉']),
    ('CYI', ARRAY['東區','西區']),
    ('CYQ', ARRAY['太保市','朴子市','布袋鎮','大林鎮','民雄鄉','溪口鄉','新港鄉','六腳鄉','東石鄉','義竹鄉','鹿草鄉','水上鄉','中埔鄉','竹崎鄉','梅山鄉','番路鄉','大埔鄉','阿里山鄉']),
    ('TNN', ARRAY['中西區','東區','南區','北區','安平區','安南區','永康區','歸仁區','新化區','左鎮區','玉井區','楠西區','南化區','仁德區','關廟區','龍崎區','官田區','麻豆區','佳里區','西港區','七股區','將軍區','學甲區','北門區','新營區','後壁區','白河區','東山區','六甲區','下營區','柳營區','鹽水區','善化區','大內區','山上區','新市區','安定區']),
    ('KHH', ARRAY['楠梓區','左營區','鼓山區','三民區','鹽埕區','前金區','新興區','苓雅區','前鎮區','旗津區','小港區','鳳山區','林園區','大寮區','大樹區','大社區','仁武區','鳥松區','岡山區','橋頭區','燕巢區','田寮區','阿蓮區','路竹區','湖內區','茄萣區','永安區','彌陀區','梓官區','旗山區','美濃區','六龜區','甲仙區','杉林區','內門區','茂林區','桃源區','那瑪夏區']),
    ('PIF', ARRAY['屏東市','潮州鎮','東港鎮','恆春鎮','萬丹鄉','長治鄉','麟洛鄉','九如鄉','里港鄉','鹽埔鄉','高樹鄉','萬巒鄉','內埔鄉','竹田鄉','新埤鄉','枋寮鄉','新園鄉','崁頂鄉','林邊鄉','南州鄉','佳冬鄉','琉球鄉','車城鄉','滿州鄉','枋山鄉','三地門鄉','霧臺鄉','瑪家鄉','泰武鄉','來義鄉','春日鄉','獅子鄉','牡丹鄉']),
    ('HUA', ARRAY['花蓮市','鳳林鎮','玉里鎮','新城鄉','吉安鄉','壽豐鄉','光復鄉','豐濱鄉','瑞穗鄉','富里鄉','秀林鄉','萬榮鄉','卓溪鄉']),
    ('TTT', ARRAY['台東市','成功鎮','關山鎮','卑南鄉','鹿野鄉','池上鄉','東河鄉','長濱鄉','太麻里鄉','大武鄉','綠島鄉','海端鄉','延平鄉','金峰鄉','達仁鄉','蘭嶼鄉']),
    ('PEN', ARRAY['馬公市','湖西鄉','白沙鄉','西嶼鄉','望安鄉','七美鄉']),
    ('KIN', ARRAY['金城鎮','金湖鎮','金沙鎮','金寧鄉','烈嶼鄉','烏坵鄉']),
    ('LIE', ARRAY['南竿鄉','北竿鄉','莒光鄉','東引鄉'])
),
expanded AS (
  SELECT
    district_seed.city_code,
    district_name,
    ordinality::INTEGER AS sort_order
  FROM district_seed
  CROSS JOIN LATERAL unnest(district_seed.names) WITH ORDINALITY AS item(district_name, ordinality)
)
INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
SELECT
  expanded.district_name,
  expanded.city_code || '-' || LPAD(expanded.sort_order::TEXT, 2, '0'),
  city.id,
  'district',
  city.name || expanded.district_name,
  ARRAY[city.name, expanded.district_name],
  expanded.sort_order
FROM expanded
JOIN ga_service_regions city ON city.code = expanded.city_code
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  parent_id = EXCLUDED.parent_id,
  region_type = EXCLUDED.region_type,
  description = EXCLUDED.description,
  included_locations = EXCLUDED.included_locations,
  sort_order = EXCLUDED.sort_order,
  status = 'active',
  updated_at = NOW();
