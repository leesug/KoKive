-- =============================================
-- KoKive Translation Tier Migration
-- 번역 등급 시스템 (haiku/sonnet)
-- =============================================

-- 1. papers 테이블에 translation_tier 칼럼 추가
ALTER TABLE papers
ADD COLUMN translation_tier ENUM('haiku', 'sonnet') DEFAULT 'haiku' COMMENT '번역 등급 (haiku=무료, sonnet=프리미엄)'
AFTER processing_status;

-- 2. paper_summaries 테이블에 translation_tier 및 upgraded_at 칼럼 추가
ALTER TABLE paper_summaries
ADD COLUMN translation_tier ENUM('haiku', 'sonnet') DEFAULT 'haiku' COMMENT '번역 등급'
AFTER ai_model,
ADD COLUMN upgraded_at DATETIME NULL COMMENT 'sonnet으로 업그레이드된 시간'
AFTER translation_tier;

-- 3. users 테이블에 membership_type 칼럼 추가 (없는 경우)
-- 이미 있을 수 있으므로 IGNORE 사용
ALTER TABLE users
ADD COLUMN IF NOT EXISTS membership_type ENUM('free', 'premium', 'pro', 'enterprise') DEFAULT 'free' COMMENT '회원 등급'
AFTER role;

-- 4. 번역 업그레이드 로그 테이블 생성
CREATE TABLE IF NOT EXISTS translation_upgrade_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    user_id INT NULL COMMENT '업그레이드를 트리거한 사용자',
    from_tier ENUM('haiku', 'sonnet') NOT NULL DEFAULT 'haiku',
    to_tier ENUM('haiku', 'sonnet') NOT NULL DEFAULT 'sonnet',
    processing_time_ms INT NULL COMMENT '처리 시간 (밀리초)',
    token_usage_input INT NULL COMMENT '입력 토큰 사용량',
    token_usage_output INT NULL COMMENT '출력 토큰 사용량',
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    error_message TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,

    KEY idx_paper_id (paper_id),
    KEY idx_user_id (user_id),
    KEY idx_status (status),
    KEY idx_created_at (created_at),

    CONSTRAINT fk_translation_log_paper FOREIGN KEY (paper_id)
        REFERENCES papers(id) ON DELETE CASCADE,
    CONSTRAINT fk_translation_log_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. 인덱스 추가
CREATE INDEX idx_papers_translation_tier ON papers(translation_tier);
CREATE INDEX idx_summaries_translation_tier ON paper_summaries(translation_tier);
CREATE INDEX idx_users_membership ON users(membership_type);

-- 6. 기존 데이터 업데이트 (모두 haiku로 설정)
UPDATE papers SET translation_tier = 'haiku' WHERE translation_tier IS NULL;
UPDATE paper_summaries SET translation_tier = 'haiku' WHERE translation_tier IS NULL;

-- =============================================
-- 통계 뷰 생성
-- =============================================

CREATE OR REPLACE VIEW v_translation_stats AS
SELECT
    p.translation_tier,
    COUNT(*) as paper_count,
    COUNT(DISTINCT u.id) as unique_upgraders
FROM papers p
LEFT JOIN translation_upgrade_logs tul ON p.id = tul.paper_id AND tul.status = 'completed'
LEFT JOIN users u ON tul.user_id = u.id
GROUP BY p.translation_tier;
