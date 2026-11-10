-- 階段 3：依冠璋確認的規則設定人員旗標（可重複執行）
update people set active = false, constraints = constraints || '{"cancelled": true}' where name = '阿國';
update people set constraints = constraints || '{"avoid_weekend": true}' where name = '王永杰';
update people set constraints = constraints || '{"solo_low_voltage": true}' where name = '阿澤';
