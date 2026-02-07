-- Update Tesla vehicle image URLs with Tesla configurator images
-- These URLs point to Tesla's configurator API images with transparent backgrounds
-- Format: https://static-assets.tesla.com/configurator/compositor?...
-- Using side profile view (STUD_SIDE) for consistent display

-- Casper: White 2019 Model 3 (Pearl White Multi-Coat)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MT311,$PPSW,$W40B,$IBB1&view=STUD_SIDE&model=m3&size=1920&bkba_opt=2'
WHERE name = 'Casper';

-- Delphi: White 2023 Model Y (Pearl White Multi-Coat)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MTY07,$PPSW,$W40B,$INPB0&view=STUD_SIDE&model=my&size=1920&bkba_opt=2'
WHERE name = 'Delphi';

-- Sloop: White 2026 Model Y (Pearl White Multi-Coat)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MTY07,$PPSW,$W40B,$INPB0&view=STUD_SIDE&model=my&size=1920&bkba_opt=2'
WHERE name = 'Sloop';

-- Cygnus: Grey 2026 Model Y (Midnight Silver Metallic)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MTY07,$PMNG,$W40B,$INPB0&view=STUD_SIDE&model=my&size=1920&bkba_opt=2'
WHERE name = 'Cygnus';

-- Kimba: White 2022 Model Y (Pearl White Multi-Coat)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MTY07,$PPSW,$W40B,$INPB0&view=STUD_SIDE&model=my&size=1920&bkba_opt=2'
WHERE name = 'Kimba';

-- Brisa Branca: White 2022 Model 3 (Pearl White Multi-Coat)
UPDATE tesla_vehicles
SET image_url = 'https://static-assets.tesla.com/configurator/compositor?context=design_studio_2&options=$MT311,$PPSW,$W40B,$IBB1&view=STUD_SIDE&model=m3&size=1920&bkba_opt=2'
WHERE name = 'Brisa Branca';
