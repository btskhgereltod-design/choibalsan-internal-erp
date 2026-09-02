ALTER TABLE organization_work_service_areas
  ADD COLUMN intake_lane_title TEXT,
  ADD COLUMN team_lane_title TEXT;

ALTER TABLE organization_work_service_areas
  ADD CONSTRAINT organization_work_service_areas_intake_lane_title_check
    CHECK(intake_lane_title IS NULL OR char_length(btrim(intake_lane_title)) BETWEEN 2 AND 160),
  ADD CONSTRAINT organization_work_service_areas_team_lane_title_check
    CHECK(team_lane_title IS NULL OR char_length(btrim(team_lane_title)) BETWEEN 2 AND 160);

UPDATE organization_work_service_areas area
SET intake_lane_title=CASE area.code
      WHEN 'road-lighting' THEN 'Авто замын гэрлийн асуудал, хэрэгцээ'
      WHEN 'ger-area-lighting' THEN 'Гэр хорооллын гэрлийн асуудал, хэрэгцээ'
      WHEN 'tower-lighting' THEN 'Цамхагийн гэрлийн асуудал, хэрэгцээ'
      WHEN 'panel-board' THEN 'Шит/Самбарын асуудал, хэрэгцээ'
      WHEN 'traffic-signal' THEN 'Гэрлэн дохионы асуудал, хэрэгцээ'
    END,
    team_lane_title=CASE area.code
      WHEN 'road-lighting' THEN 'Авто замын гэрэлтүүлгийн хэсгийн ажил'
      WHEN 'ger-area-lighting' THEN 'Гэр хорооллын гэрэлтүүлгийн хэсгийн ажил'
      WHEN 'tower-lighting' THEN 'Цамхагийн гэрэлтүүлгийн хэсгийн ажил'
      WHEN 'panel-board' THEN 'Шит/Самбарын ажил'
      WHEN 'traffic-signal' THEN 'Гэрлэн дохионы хэсгийн ажил'
    END
FROM organizations organization
WHERE organization.id=area.organization_id
  AND organization.slug='choibalsan-hugjil'
  AND area.domain='lighting'
  AND area.code IN('road-lighting','ger-area-lighting','tower-lighting','panel-board','traffic-signal');
