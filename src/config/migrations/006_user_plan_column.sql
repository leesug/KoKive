-- =============================================
-- KoKive User Plan Column Migration
-- role과 plan 분리: role은 user/admin, plan은 free/basic/pro
-- =============================================

-- 1. plan 컬럼 추가
ALTER TABLE users ADD COLUMN plan ENUM('free', 'basic', 'pro') DEFAULT 'free' AFTER role;

-- 2. 기존 데이터 마이그레이션
-- role이 'pro'인 사용자는 plan을 'pro'로, role을 'user'로 변경
UPDATE users SET plan = 'pro', role = 'user' WHERE role = 'pro';

-- 3. role이 'free'인 사용자는 role을 'user'로 변경
UPDATE users SET role = 'user' WHERE role = 'free';

-- 4. role 컬럼 타입 변경 (user, admin만 허용)
-- 먼저 새로운 컬럼으로 데이터 이전
ALTER TABLE users ADD COLUMN role_new VARCHAR(10) DEFAULT 'user';
UPDATE users SET role_new = CASE
    WHEN role = 'admin' THEN 'admin'
    ELSE 'user'
END;

-- 기존 role 컬럼 삭제하고 새 컬럼으로 교체
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users CHANGE COLUMN role_new role VARCHAR(10) DEFAULT 'user';

-- 5. 인덱스 추가
CREATE INDEX idx_plan ON users(plan);
